export { departureHandle, departureName } from "./departure-names";
type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };
export type GuardianDeparture = {
  id: string; participantId: string | null; displayName: string | null;
  observedAt: Date; type: "forum.left" | "forum.removed";
  archivedUsername: string | null; archivedDisplayName: string | null;
  // What the person is known by now, for profiles still named by the placeholder.
  telegramUsername?: string | null; telegramOwnName?: string | null;
  // Earliest known arrival to the forum; null when the Core has no record of it.
  joinedAt?: Date | null;
};

export type DeparturePeriod = { from?: string; to?: string };

export function departureDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

export function departuresInPeriod(events: GuardianDeparture[], period: DeparturePeriod) {
  const from = departureDate(period.from), to = departureDate(period.to);
  // Moscow calendar days, inclusive on both ends; do not depend on the server timezone.
  return events.filter(event => {
    const day = event.observedAt.toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
    return (!from || day >= from) && (!to || day <= to);
  });
}

export function departurePeople(events: GuardianDeparture[]) {
  return new Set(events.map(event => event.participantId ? 'participant:' + event.participantId : 'event:' + event.id)).size;
}

export async function getGuardianDeparturesWithDatabase(database: Database, onlyEventId?: string) {
  const result = await database.query(
    `SELECT event.id, event.participant_id, participant.display_name, event.event_type,
            telegram.username AS telegram_username,
            NULLIF(btrim(concat_ws(' ', telegram.first_name, telegram.last_name)), '') AS telegram_own_name,
            (SELECT min(COALESCE((joined.payload->>'observed_at')::timestamptz, joined.created_at))
               FROM events joined WHERE joined.participant_id = event.participant_id
                AND joined.event_type = 'forum.joined') AS joined_at,
            event.payload->>'archived_username' AS archived_username,
            event.payload->>'archived_display_name' AS archived_display_name,
            COALESCE((event.payload->>'observed_at')::timestamptz, event.created_at) AS observed_at,
            COALESCE((event.payload->>'observed_at')::timestamptz, event.created_at)
              >= clock_timestamp() - interval '30 days' AS recent
       FROM events event LEFT JOIN participants participant ON participant.id = event.participant_id
       LEFT JOIN external_identities telegram ON telegram.participant_id = event.participant_id AND telegram.provider = 'telegram'
      WHERE event.event_type IN ('forum.left', 'forum.removed') AND ($1::bigint IS NULL OR event.id = $1::bigint)
      ORDER BY observed_at DESC, event.id DESC`,
    [onlyEventId ?? null],
  );
  const events = result.rows.map((row): GuardianDeparture => ({
      id: String(row.id), participantId: row.participant_id == null ? null : String(row.participant_id),
      displayName: row.display_name == null ? null : String(row.display_name),
      archivedUsername: row.archived_username == null ? null : String(row.archived_username),
      archivedDisplayName: row.archived_display_name == null ? null : String(row.archived_display_name),
      telegramUsername: row.telegram_username == null || !String(row.telegram_username).trim() ? null : String(row.telegram_username),
      telegramOwnName: row.telegram_own_name == null ? null : String(row.telegram_own_name),
      joinedAt: row.joined_at == null ? null : new Date(String(row.joined_at)),
      observedAt: new Date(String(row.observed_at)), type: row.event_type as GuardianDeparture["type"],
    }));
  return { total: departurePeople(events),
    last30Days: departurePeople(events.filter((_, index) => result.rows[index].recent === true)), events };
}

export async function getGuardianDepartureSummaryWithDatabase(database: Database) {
  const result = await database.query(`SELECT count(DISTINCT COALESCE(participant_id::text, 'event:' || id::text))::integer AS total,
    count(DISTINCT COALESCE(participant_id::text, 'event:' || id::text)) FILTER (WHERE COALESCE((payload->>'observed_at')::timestamptz, created_at)
      >= clock_timestamp() - interval '30 days')::integer AS last_30_days
    FROM events WHERE event_type IN ('forum.left', 'forum.removed')`);
  return { total: Number(result.rows[0]?.total ?? 0), last30Days: Number(result.rows[0]?.last_30_days ?? 0) };
}

export async function getGuardianDepartureSummary() {
  const { pool } = await import("./db");
  return getGuardianDepartureSummaryWithDatabase(pool);
}

export async function getGuardianDepartures() {
  const { pool } = await import("./db");
  return getGuardianDeparturesWithDatabase(pool);
}
