import { createNotificationWithDatabase } from "./notifications";
import { normalizeInterest, normalizeResidence, type Residence } from "./profile-about";

// One-off transfer of the city and interests people named in their own introductions (forum topic
// «Соты», reception) into profiles that are still empty. The owner's decision: write and tell the
// person, with no DARUS for it — they did not do the work — and without reopening the first-action
// reward later. Whatever a person filled in themselves is never touched.
type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
type Client = { query(text: string, values?: unknown[]): Promise<QueryResult>; release(): void };
export type IntroductionDatabase = { connect(): Promise<Client> };
export type IntroductionEntry = { telegramUserId: string; residence: Residence | null; interests: string[] };
export type IntroductionTexts = { both: string; city: string; interests: string; action: string };
export type IntroductionImportResult = {
  entries: number; unknown: number; departed: number; alreadyImported: number; nothingToWrite: number;
  participants: number; residences: number; residencesKept: number; interestOwners: number; interests: number; interestsKept: number;
};

export class IntroductionImportValidationError extends Error {
  constructor(message: string) { super(message); this.name = "IntroductionImportValidationError"; }
}

export function parseIntroductionEntries(value: unknown): IntroductionEntry[] {
  if (!Array.isArray(value)) throw new IntroductionImportValidationError("Expected a list of entries");
  const seen = new Set<string>();
  return value.map((raw) => {
    const item = raw as { telegram_user_id?: unknown; residence?: unknown; interests?: unknown } | null;
    const telegramUserId = typeof item?.telegram_user_id === "string" ? item.telegram_user_id : "";
    if (!/^[1-9]\d*$/.test(telegramUserId) || seen.has(telegramUserId)) throw new IntroductionImportValidationError("Invalid or repeated Telegram user ID");
    seen.add(telegramUserId);
    try {
      const place = item?.residence as { name?: unknown; type?: unknown; country?: unknown } | null | undefined;
      const residence = place ? normalizeResidence({ name: place.name, type: place.type, country: place.country }) : null;
      const labels = new Map<string, string>();
      for (const label of Array.isArray(item?.interests) ? item.interests : []) {
        const interest = normalizeInterest(label);
        if (interest) labels.set(interest.toLocaleLowerCase("ru-RU"), interest);
      }
      return { telegramUserId, residence, interests: [...labels.values()] };
    } catch { throw new IntroductionImportValidationError("Invalid residence or interest"); }
  });
}

const MARKER = "profile.introduction_imported";

export async function importIntroductions(
  database: IntroductionDatabase, entries: IntroductionEntry[], texts: IntroductionTexts, apply: boolean,
): Promise<IntroductionImportResult> {
  const result: IntroductionImportResult = { entries: entries.length, unknown: 0, departed: 0, alreadyImported: 0, nothingToWrite: 0,
    participants: 0, residences: 0, residencesKept: 0, interestOwners: 0, interests: 0, interestsKept: 0 };
  for (const entry of entries) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(
        `SELECT p.id, p.membership_status, p.residence_name,
                (SELECT count(*)::integer FROM participant_interests i WHERE i.participant_id = p.id) AS interests,
                EXISTS (SELECT 1 FROM events e WHERE e.participant_id = p.id AND e.event_type = $2) AS imported
           FROM external_identities identity JOIN participants p ON p.id = identity.participant_id
          WHERE identity.provider = 'telegram' AND identity.external_user_id = $1
          FOR UPDATE OF p`, [entry.telegramUserId, MARKER]);
      const person = found.rows[0];
      const writeResidence = Boolean(entry.residence) && person?.residence_name == null;
      const writeInterests = entry.interests.length > 0 && Number(person?.interests ?? 0) === 0;
      if (!person) result.unknown++;
      else if (person.membership_status === "left" || person.membership_status === "excluded") result.departed++;
      // A repeated run must not bring back what the person has since removed.
      else if (person.imported) result.alreadyImported++;
      else if (!writeResidence && !writeInterests) {
        result.nothingToWrite++;
        if (entry.residence) result.residencesKept++;
        if (entry.interests.length) result.interestsKept++;
      } else {
        const id = String(person.id);
        result.participants++;
        if (entry.residence && !writeResidence) result.residencesKept++;
        if (entry.interests.length && !writeInterests) result.interestsKept++;
        if (writeResidence) result.residences++;
        if (writeInterests) { result.interestOwners++; result.interests += entry.interests.length; }
        if (apply) {
          // Closing the first action beforehand makes the reward trigger see it as already done:
          // nothing is minted now, and the same first action cannot be rewarded later either.
          const close = (source: string) => client.query(
            `INSERT INTO onboarding_quest_completions(participant_id, source_type, first_action_at, origin)
             VALUES ($1::uuid, $2, clock_timestamp(), 'historical') ON CONFLICT DO NOTHING`, [id, source]);
          if (writeResidence) {
            await close("residence_first_filled");
            await client.query(
              `UPDATE participants SET residence_name = $2, updated_at = now() WHERE id = $1::uuid`,
              [id, entry.residence!.name]);
          }
          if (writeInterests) {
            await close("interest_first_added");
            for (const label of entry.interests) {
              await client.query(
                `INSERT INTO participant_interests(participant_id, label, normalized_label, visibility) VALUES ($1::uuid, $2, $3, 'members')`,
                [id, label, label.toLocaleLowerCase("ru-RU")]);
            }
          }
          await client.query(`INSERT INTO events(event_type, participant_id, payload) VALUES ($2, $1::uuid, $3::jsonb)`,
            [id, MARKER, JSON.stringify({ residence: writeResidence, interests: writeInterests ? entry.interests.length : 0 })]);
          const template = writeResidence && writeInterests ? texts.both : writeResidence ? texts.city : texts.interests;
          const text = template.replaceAll("{city}", writeResidence ? entry.residence!.name : "")
            .replaceAll("{interests}", writeInterests ? entry.interests.join(", ") : "");
          // The notice joins this transaction: a person is never changed without being told.
          await createNotificationWithDatabase({ connect: async () => ({
            query: (sql: string, values?: unknown[]) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)
              ? Promise.resolve({ rowCount: 0, rows: [] }) : client.query(sql, values),
            release() {},
          }) }, { participantId: id, notificationType: MARKER, text, actionUrl: "/profile", actionLabel: texts.action,
            sourceType: "system", queueTelegram: true });
        }
      }
      await client.query(apply ? "COMMIT" : "ROLLBACK");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* Preserve the original error. */ }
      throw error;
    } finally { client.release(); }
  }
  return result;
}
