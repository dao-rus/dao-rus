// Historical forum joins recovered from a Telegram export of the forum's service messages.
// They enter the same lifecycle history the reception webhook writes (forum.joined, forum.rejoined),
// dated by the moment Telegram recorded, so Core stops presenting the day its database was filled
// as the day a person came.
type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
type Client = { query(text: string, values?: unknown[]): Promise<QueryResult>; release(): void };
export type ForumJoinDatabase = { connect(): Promise<Client> };
// `approximate` marks a first sign of presence (an introduction, a message, a reaction) used where
// Telegram kept no join record: the person was in the DAO by then, the true join is not later.
export type ForumJoinEntry = { telegramUserId: string; joins: Array<{ at: string; messageId: number; approximate: boolean }> };
export type ForumJoinImportResult = {
  entries: number; unknown: number; participants: number; joined: number; rejoined: number; alreadyImported: number; reclassified: number; exactKnown: number;
};

export class ForumJoinImportValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ForumJoinImportValidationError"; }
}

export const FORUM_JOIN_EXPORT_SOURCE = "telegram_export";

export function parseForumJoinEntries(value: unknown): ForumJoinEntry[] {
  if (!Array.isArray(value)) throw new ForumJoinImportValidationError("Expected a list of entries");
  const users = new Set<string>();
  return value.map((raw) => {
    const item = raw as { telegram_user_id?: unknown; joins?: unknown } | null;
    const telegramUserId = typeof item?.telegram_user_id === "string" ? item.telegram_user_id : "";
    if (!/^[1-9]\d*$/.test(telegramUserId) || users.has(telegramUserId)) throw new ForumJoinImportValidationError("Invalid or repeated Telegram user ID");
    users.add(telegramUserId);
    if (!Array.isArray(item?.joins) || !item.joins.length) throw new ForumJoinImportValidationError("An entry needs at least one join");
    const messages = new Set<number>();
    const joins = item.joins.map((join) => {
      const { at, message_id: messageId, approximate } = (join ?? {}) as { at?: unknown; message_id?: unknown; approximate?: unknown };
      if (typeof at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(at) || !Number.isFinite(Date.parse(at)) ||
          Date.parse(at) > Date.now() || typeof messageId !== "number" || !Number.isSafeInteger(messageId) || messageId <= 0 || messages.has(messageId) ||
          (approximate !== undefined && typeof approximate !== "boolean")) {
        throw new ForumJoinImportValidationError("Invalid join time or message ID");
      }
      messages.add(messageId);
      return { at: new Date(at).toISOString(), messageId, approximate: approximate === true };
    }).sort((left, right) => left.at.localeCompare(right.at));
    // A first sign of presence stands alone: it never mixes with recorded joins or with another guess.
    if (joins.some((join) => join.approximate) && joins.length !== 1) throw new ForumJoinImportValidationError("An approximate entry holds exactly one date");
    return { telegramUserId, joins };
  });
}

export async function importForumJoins(database: ForumJoinDatabase, entries: ForumJoinEntry[], apply: boolean): Promise<ForumJoinImportResult> {
  const result: ForumJoinImportResult = { entries: entries.length, unknown: 0, participants: 0, joined: 0, rejoined: 0, alreadyImported: 0, reclassified: 0, exactKnown: 0 };
  for (const entry of entries) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(
        `SELECT p.id FROM external_identities identity JOIN participants p ON p.id = identity.participant_id
          WHERE identity.provider = 'telegram' AND identity.external_user_id = $1 FOR UPDATE OF p`, [entry.telegramUserId]);
      if (!found.rowCount) { result.unknown++; await client.query("ROLLBACK"); continue; }
      const id = String(found.rows[0].id);
      const known = await client.query(
        `SELECT payload->>'source_message_id' AS message_id FROM events
          WHERE participant_id = $1::uuid AND event_type IN ('forum.joined', 'forum.rejoined') AND payload->>'source' = $2`,
        [id, FORUM_JOIN_EXPORT_SOURCE]);
      const imported = new Set(known.rows.map((row) => String(row.message_id)));
      if (entry.joins[0].approximate) {
        // A guess never competes with a join that is actually on record, whoever recorded it.
        const exact = await client.query(
          `SELECT 1 FROM events WHERE participant_id = $1::uuid AND event_type = 'forum.joined' LIMIT 1`, [id]);
        if (exact.rowCount) {
          if (imported.has(String(entry.joins[0].messageId))) result.alreadyImported++; else result.exactKnown++;
          await client.query("ROLLBACK"); continue;
        }
      }
      let wrote = false;
      for (const [index, join] of entry.joins.entries()) {
        if (imported.has(String(join.messageId))) { result.alreadyImported++; continue; }
        const type = index === 0 ? "forum.joined" : "forum.rejoined";
        if (index === 0) result.joined++; else result.rejoined++;
        wrote = true;
        if (apply) await client.query(
          `INSERT INTO events(event_type, participant_id, created_at, payload) VALUES ($1, $2::uuid, $3::timestamptz, $4::jsonb)`,
          [type, id, join.at, JSON.stringify({ source: FORUM_JOIN_EXPORT_SOURCE, source_message_id: join.messageId, observed_at: join.at,
            ...(join.approximate ? { approximate: true } : {}) })]);
      }
      // A join Core itself observed after the recovered first one was in fact a return.
      const later = await client.query(
        `${apply ? "UPDATE events SET event_type = 'forum.rejoined'" : "SELECT id FROM events"}
          WHERE participant_id = $1::uuid AND event_type = 'forum.joined' AND payload->>'source' IS DISTINCT FROM $2
            AND COALESCE((payload->>'observed_at')::timestamptz, created_at) > $3::timestamptz`,
        [id, FORUM_JOIN_EXPORT_SOURCE, entry.joins[0].at]);
      result.reclassified += later.rowCount ?? 0;
      if (wrote || later.rowCount) result.participants++;
      await client.query(apply ? "COMMIT" : "ROLLBACK");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* Preserve the original error. */ }
      throw error;
    } finally { client.release(); }
  }
  return result;
}

// The first moment the person is known to have entered the forum; null when history does not reach that far.
export async function getForumJoinDateWithDatabase(
  database: { query(text: string, values?: unknown[]): Promise<QueryResult> }, participantId: string,
): Promise<Date | null> {
  const result = await database.query(
    `SELECT min(COALESCE((payload->>'observed_at')::timestamptz, created_at)) AS joined_at
       FROM events WHERE participant_id = $1::uuid AND event_type = 'forum.joined'`, [participantId]);
  return result.rows[0]?.joined_at ? new Date(String(result.rows[0].joined_at)) : null;
}

export async function getForumJoinDate(participantId: string): Promise<Date | null> {
  const { pool } = await import("./db");
  return getForumJoinDateWithDatabase(pool, participantId);
}
