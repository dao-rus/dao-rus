import { lockExistingTelegramParticipantById, TelegramParticipantIdentityConflictError,
  type TelegramParticipantClient } from "./telegram-participant";
import { receptionProfileText } from "./reception-profile-extraction";

type Client = TelegramParticipantClient;
type Fields = "residence_name" | "profile_occupation";
export type ReceptionProfileApplyResult = { participantId: string | null; fields: Fields[] };

// Caller owns the transaction. Both event orders use the application lock first,
// then identity, onboarding and Participant row locks. Manual profile edits lock
// the same Participant row: whichever runs last still preserves the manual value.
export async function applyReceptionDraftWithClient(
  client: Client, telegramUserId: string,
): Promise<ReceptionProfileApplyResult> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`reception-application:${telegramUserId}`]);
  const app = (await client.query(`SELECT id, participant_id, city, occupation, source_message_update_id
    FROM reception_applications WHERE telegram_user_id=$1 AND status='draft' FOR UPDATE`, [telegramUserId])).rows[0];
  if (!app || app.source_message_update_id == null) return { participantId: null, fields: [] };
  const participantId = await lockExistingTelegramParticipantById(client, telegramUserId);
  if (!participantId) return { participantId: null, fields: [] };
  if (app.participant_id != null && app.participant_id !== participantId) throw new TelegramParticipantIdentityConflictError();
  const forum = (await client.query(`SELECT forum_status FROM participant_forum_onboarding
    WHERE participant_id=$1 FOR UPDATE`, [participantId])).rows[0];
  if (forum?.forum_status !== "joined") return { participantId, fields: [] };
  // Require the original successful private relay, not a forum comment or a guessed username.
  const relay = await client.query(`SELECT update_id FROM reception_relay_updates
    WHERE update_id=$1 AND private_chat_id=$2::bigint AND direction='private_to_forum' AND status='sent'`,
  [app.source_message_update_id, telegramUserId]);
  if (!relay.rowCount) return { participantId, fields: [] };
  const person = (await client.query(`SELECT residence_name, profile_occupation FROM participants
    WHERE id=$1 FOR UPDATE`, [participantId])).rows[0];
  if (!person) return { participantId: null, fields: [] };
  const history = await client.query(`SELECT event_type, payload FROM events WHERE participant_id=$1
    AND event_type IN ('participant.reception_profile_applied','participant.about_updated','participant.profile_updated')`, [participantId]);
  const protectedFields = new Set<string>();
  for (const event of history.rows) {
    const payload = event.payload as { field?: string; fields?: string[] } | null;
    if (payload?.field === "residence") protectedFields.add("residence_name");
    for (const field of payload?.fields ?? []) protectedFields.add(field);
  }
  const values = { residence_name: receptionProfileText(app.city, 200), profile_occupation: receptionProfileText(app.occupation, 1000) };
  const fields = (Object.keys(values) as Fields[]).filter(field => values[field] !== null
    && !String(person[field] ?? "").trim() && !protectedFields.has(field));
  if (app.participant_id == null) await client.query("UPDATE reception_applications SET participant_id=$2 WHERE id=$1", [app.id, participantId]);
  if (fields.length) {
    await client.query(`UPDATE participants SET
      residence_name=CASE WHEN $2::boolean AND NULLIF(btrim(residence_name),'') IS NULL THEN $3 ELSE residence_name END,
      profile_occupation=CASE WHEN $4::boolean AND NULLIF(btrim(profile_occupation),'') IS NULL THEN $5 ELSE profile_occupation END,
      updated_at=now() WHERE id=$1`,
    [participantId, fields.includes("residence_name"), values.residence_name, fields.includes("profile_occupation"), values.profile_occupation]);
    await client.query(`INSERT INTO events(event_type,participant_id,payload)
      VALUES ('participant.reception_profile_applied',$1,$2::jsonb)`, [participantId, JSON.stringify({
      application_id: app.id, source_message_update_id: String(app.source_message_update_id), fields,
      values: Object.fromEntries(fields.map(field => [field, values[field]])),
    })]);
  }
  return { participantId, fields };
}

// A Mini App confirmation may correct our own unedited automatic projection once.
// After submission, normal empty-only profile rules apply again.
export async function receptionDraftCorrectionFields(
  client: Client, participantId: string, applicationId: string,
): Promise<Fields[]> {
  const person = (await client.query("SELECT residence_name, profile_occupation FROM participants WHERE id=$1 FOR UPDATE", [participantId])).rows[0];
  const events = await client.query(`SELECT event_type,payload FROM events WHERE participant_id=$1
    AND event_type IN ('participant.reception_profile_applied','participant.about_updated','participant.profile_updated') ORDER BY id`, [participantId]);
  const fields = new Set<Fields>();
  for (const event of events.rows) {
    const payload = event.payload as { application_id?: string; field?: string; fields?: Fields[]; values?: Partial<Record<Fields,string>> };
    if (event.event_type === "participant.reception_profile_applied" && payload.application_id === applicationId) {
      for (const field of payload.fields ?? []) if (person?.[field] === payload.values?.[field]) fields.add(field);
    } else {
      if (payload.field === "residence") fields.delete("residence_name");
      for (const field of payload.fields ?? []) fields.delete(field);
    }
  }
  return [...fields];
}
