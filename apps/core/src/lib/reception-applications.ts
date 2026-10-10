import type { Pool } from "pg";
import { pool } from "./db";
import { inspectTelegramParticipantById, TelegramParticipantIdentityConflictError } from "./telegram-participant";
import type { TelegramIdentityProfile } from "./identity";
import { receptionTelegramName, receptionTelegramUsername } from "./reception-telegram-profile";

export class ReceptionApplicationError extends Error {
  constructor(public readonly code: "invalid_form" | "not_found" | "rate_limit" | "identity_conflict") {
    super(code);
  }
}

export type ReceptionForm = {
  city: string;
  occupation: string;
  age: number | null;
  publishAge: boolean;
};

export function validateReceptionForm(value: unknown): ReceptionForm {
  const invalid = () => { throw new ReceptionApplicationError("invalid_form"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).some(key => !["city", "occupation", "age", "publishAge"].includes(key))) return invalid();
  const text = (value: unknown, max: number) => {
    if (typeof value !== "string") return invalid();
    const trimmed = value.trim();
    if (!trimmed || [...trimmed].length > max || /[\u0000-\u001f\u007f]/u.test(trimmed)) return invalid();
    return trimmed;
  };
  const age = fields.age ?? null;
  if (age !== null && (typeof age !== "number" || !Number.isInteger(age) || age < 1 || age > 120)) return invalid();
  if (typeof fields.publishAge !== "boolean" || (fields.publishAge && age === null)) return invalid();
  return { city: text(fields.city, 200), occupation: text(fields.occupation, 1000), age, publishAge: fields.publishAge };
}

// Explicit projection: internal identity links, quota and delivery diagnostics are never exposed.
const selectApplication = `SELECT a.id, a.city, a.occupation, a.age, a.publish_age AS "publishAge",
  a.status, a.revision, a.created_at AS "createdAt", a.updated_at AS "updatedAt",
  p.status AS "publicationStatus", p.delivered_revision AS "publishedRevision",
  COALESCE(i.status, 'not_requested') AS "invitationStatus"
  FROM reception_applications a
  JOIN reception_application_deliveries p ON p.application_id = a.id AND p.kind = 'publication'
  LEFT JOIN reception_application_deliveries i ON i.application_id = a.id AND i.kind = 'invitation'
  WHERE a.telegram_user_id = $1`;

export async function getReceptionApplication(telegramUserId: string, database: Pool = pool) {
  return (await database.query(selectApplication, [telegramUserId])).rows[0] ?? null;
}

export async function saveReceptionApplication(
  telegramUserId: string,
  input: unknown,
  updateOnly = false,
  database: Pool = pool,
  telegramProfile?: TelegramIdentityProfile,
) {
  const form = validateReceptionForm(input);
  if (telegramProfile && telegramProfile.telegramUserId !== telegramUserId) throw new ReceptionApplicationError("identity_conflict");
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    // Serializes first submissions, updates and quotas across all app instances.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`reception-application:${telegramUserId}`]);
    const existing = (await client.query("SELECT * FROM reception_applications WHERE telegram_user_id = $1 FOR UPDATE", [telegramUserId])).rows[0];
    if (updateOnly && !existing) throw new ReceptionApplicationError("not_found");
    const now: Date = (await client.query("SELECT clock_timestamp() AS now")).rows[0].now;
    const sameWindow = existing && now.getTime() - existing.write_window_started_at.getTime() < 60_000;
    if (sameWindow && existing.write_window_count >= 10) throw new ReceptionApplicationError("rate_limit");

    // Read-only identity resolution. Never call resolveTelegramParticipant or profile synchronization.
    let participantId: string | null;
    try {
      participantId = await inspectTelegramParticipantById(client, telegramUserId);
    } catch (error) {
      if (error instanceof TelegramParticipantIdentityConflictError) throw new ReceptionApplicationError("identity_conflict");
      throw error;
    }
    const miniAppIdentity = (await client.query(`SELECT participant_id, external_user_id FROM external_identities
      WHERE provider = 'telegram' AND provider_subject = $1`, [`miniapp:${telegramUserId}`])).rows[0];
    if (miniAppIdentity) {
      if ((participantId && participantId !== miniAppIdentity.participant_id)
        || (miniAppIdentity.external_user_id && miniAppIdentity.external_user_id !== telegramUserId)) {
        throw new ReceptionApplicationError("identity_conflict");
      }
      participantId = miniAppIdentity.participant_id;
    }
    let created = false;
    const name = telegramProfile ? receptionTelegramName(telegramProfile.firstName, telegramProfile.lastName) : existing?.telegram_name ?? null;
    const username = telegramProfile ? receptionTelegramUsername(telegramProfile.username) : existing?.telegram_username ?? null;
    if (!existing) {
      const result = await client.query(`INSERT INTO reception_applications
        (telegram_user_id, participant_id, city, occupation, age, publish_age, write_window_started_at, telegram_name, telegram_username)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [telegramUserId, participantId, form.city, form.occupation, form.age, form.publishAge, now, name, username]);
      await client.query(`INSERT INTO reception_application_deliveries(application_id, kind)
        VALUES ($1, 'publication')`, [result.rows[0].id]);
      created = true;
    } else {
      const changed = existing.city !== form.city || existing.occupation !== form.occupation
        || existing.age !== form.age || existing.publish_age !== form.publishAge
        || existing.telegram_name !== name || existing.telegram_username !== username;
      await client.query(`UPDATE reception_applications SET participant_id=$2, city=$3, occupation=$4,
        age=$5, publish_age=$6, revision=revision+$7,
        updated_at=CASE WHEN $7=1 THEN $8 ELSE updated_at END,
        write_window_started_at=$9, write_window_count=$10, telegram_name=$11, telegram_username=$12 WHERE telegram_user_id=$1`,
      [telegramUserId, participantId, form.city, form.occupation, form.age, form.publishAge,
        changed ? 1 : 0, now, sameWindow ? existing.write_window_started_at : now,
        sameWindow ? existing.write_window_count + 1 : 1, name, username]);
      // Preserve confirmed/ambiguous delivery state. The worker reconciles revisions without a new send.
    }
    const application = (await client.query(selectApplication, [telegramUserId])).rows[0];
    await client.query("COMMIT");
    return { application, created };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
