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

export async function getGuardianDeparturesWithDatabase(database: Database) {
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
      WHERE event.event_type IN ('forum.left', 'forum.removed')
      ORDER BY observed_at DESC, event.id DESC`,
  );
  return {
    total: result.rows.length,
    last30Days: result.rows.filter((row) => row.recent === true).length,
    events: result.rows.map((row): GuardianDeparture => ({
      id: String(row.id), participantId: row.participant_id == null ? null : String(row.participant_id),
      displayName: row.display_name == null ? null : String(row.display_name),
      archivedUsername: row.archived_username == null ? null : String(row.archived_username),
      archivedDisplayName: row.archived_display_name == null ? null : String(row.archived_display_name),
      telegramUsername: row.telegram_username == null || !String(row.telegram_username).trim() ? null : String(row.telegram_username),
      telegramOwnName: row.telegram_own_name == null ? null : String(row.telegram_own_name),
      joinedAt: row.joined_at == null ? null : new Date(String(row.joined_at)),
      observedAt: new Date(String(row.observed_at)), type: row.event_type as GuardianDeparture["type"],
    })),
  };
}

export async function getGuardianDepartureSummaryWithDatabase(database: Database) {
  const result = await database.query(`SELECT count(*)::integer AS total,
    count(*) FILTER (WHERE COALESCE((payload->>'observed_at')::timestamptz, created_at)
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
