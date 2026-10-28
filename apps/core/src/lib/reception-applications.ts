import type { Pool } from "pg";
import { pool } from "./db";
import { findOrCreateParticipantByTelegramId, TelegramParticipantIdentityConflictError } from "./telegram-participant";
import type { TelegramIdentityProfile } from "./identity";
import { receptionTelegramName, receptionTelegramUsername } from "./reception-telegram-profile";
import { receptionDraftCorrectionFields } from "./reception-profile-apply";

export class ReceptionApplicationError extends Error {
  constructor(public readonly code: "invalid_form" | "not_found" | "rate_limit" | "identity_conflict") {
    super(code);
  }
}

export type ReceptionForm = {
  city: string;
  occupation: string;
  age: number | null;
  education: string | null;
  familyStatus: string | null;
  publishAge: boolean;
};

export function validateReceptionForm(value: unknown): ReceptionForm {
  const invalid = () => { throw new ReceptionApplicationError("invalid_form"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).some(key => !["city", "occupation", "age", "education", "familyStatus", "publishAge"].includes(key))) return invalid();
  const text = (value: unknown, max: number) => {
    if (typeof value !== "string") return invalid();
    const trimmed = value.trim();
    if (!trimmed || [...trimmed].length > max || /[\u0000-\u001f\u007f]/u.test(trimmed)) return invalid();
    return trimmed;
  };
  const age = fields.age ?? null;
  if (age !== null && (typeof age !== "number" || !Number.isInteger(age) || age < 1 || age > 120)) return invalid();
  if (typeof fields.publishAge !== "boolean" || (fields.publishAge && age === null)) return invalid();
  const optionalText = (value: unknown, max: number) => value === null || value === undefined || value === "" ? null : text(value, max);
  return { city: text(fields.city, 200), occupation: text(fields.occupation, 1000), age,
    education: optionalText(fields.education, 500), familyStatus: optionalText(fields.familyStatus, 120), publishAge: fields.publishAge };
}

// Explicit projection: internal identity links, quota and delivery diagnostics are never exposed.
const selectApplication = `SELECT a.id, a.city, a.occupation, a.age, a.education, a.family_status AS "familyStatus", a.publish_age AS "publishAge",
  a.status, a.revision, a.created_at AS "createdAt", a.updated_at AS "updatedAt",
  COALESCE(i.status, 'not_requested') AS "invitationStatus"
  FROM reception_applications a
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

    let participantId: string | null;
    try {
      participantId = await findOrCreateParticipantByTelegramId(client, telegramUserId, "telegram_reception");
    } catch (error) {
      if (error instanceof TelegramParticipantIdentityConflictError) throw new ReceptionApplicationError("identity_conflict");
      throw error;
    }
    if (existing?.participant_id && existing.participant_id !== participantId) throw new ReceptionApplicationError("identity_conflict");
    const corrections = existing?.status === "draft"
      ? await receptionDraftCorrectionFields(client, participantId, existing.id) : [];
    await client.query(`UPDATE participants SET
      profile_age = COALESCE($2, profile_age),
      residence_name = CASE WHEN NULLIF(btrim(residence_name), '') IS NULL OR $7 THEN $3 ELSE residence_name END,
      profile_occupation = CASE WHEN NULLIF(btrim(profile_occupation), '') IS NULL OR $8 THEN $4 ELSE profile_occupation END,
      profile_education = COALESCE(profile_education, $5),
      profile_family_status = COALESCE(profile_family_status, $6),
      updated_at = now()
      WHERE id=$1::uuid`, [participantId, form.age, form.city, form.occupation, form.education, form.familyStatus,
        corrections.includes("residence_name"), corrections.includes("profile_occupation")]);
    let created = false;
    const name = telegramProfile ? receptionTelegramName(telegramProfile.firstName, telegramProfile.lastName) : existing?.telegram_name ?? null;
    const username = telegramProfile ? receptionTelegramUsername(telegramProfile.username) : existing?.telegram_username ?? null;
    if (!existing) {
      await client.query(`INSERT INTO reception_applications
        (telegram_user_id, participant_id, city, occupation, age, education, family_status, publish_age, status, write_window_started_at, telegram_name, telegram_username)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted',$9,$10,$11)`,
      [telegramUserId, participantId, form.city, form.occupation, form.age, form.education, form.familyStatus, form.publishAge, now, name, username]);
      created = true;
    } else {
      const changed = existing.city !== form.city || existing.occupation !== form.occupation
        || existing.age !== form.age || existing.education !== form.education || existing.family_status !== form.familyStatus || existing.publish_age !== form.publishAge
        || existing.telegram_name !== name || existing.telegram_username !== username;
      await client.query(`UPDATE reception_applications SET participant_id=$2, city=$3, occupation=$4,
        age=$5, education=$6, family_status=$7, publish_age=$8, status='submitted', revision=revision+$9,
        updated_at=CASE WHEN $9=1 THEN $10 ELSE updated_at END,
        write_window_started_at=$11, write_window_count=$12, telegram_name=$13, telegram_username=$14 WHERE telegram_user_id=$1`,
      [telegramUserId, participantId, form.city, form.occupation, form.age, form.education, form.familyStatus, form.publishAge,
        changed ? 1 : 0, now, sameWindow ? existing.write_window_started_at : now,
        sameWindow ? existing.write_window_count + 1 : 1, name, username]);
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
