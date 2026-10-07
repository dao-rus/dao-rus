type Database = { query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };
export type GuardianArrival = {
  id: string; participantId: string | null; displayName: string | null; username: string | null;
  observedAt: Date; type: "forum.joined" | "forum.rejoined";
};

export async function getGuardianArrivalsWithDatabase(database: Database) {
  const result = await database.query(
    `SELECT event.id, event.participant_id, participant.display_name, event.event_type,
            (SELECT identity.username FROM external_identities identity
              WHERE identity.participant_id = event.participant_id AND identity.provider = 'telegram'
              ORDER BY identity.id LIMIT 1) AS username,
            COALESCE((event.payload->>'observed_at')::timestamptz, event.created_at) AS observed_at,
            COALESCE((event.payload->>'observed_at')::timestamptz, event.created_at)
              >= clock_timestamp() - interval '30 days' AS recent
       FROM events event LEFT JOIN participants participant ON participant.id = event.participant_id
      WHERE event.event_type IN ('forum.joined', 'forum.rejoined')
      ORDER BY observed_at DESC, event.id DESC`,
  );
  return {
    total: result.rows.length,
    last30Days: result.rows.filter((row) => row.recent === true).length,
    events: result.rows.map((row): GuardianArrival => ({
      id: String(row.id), participantId: row.participant_id == null ? null : String(row.participant_id),
      displayName: row.display_name == null ? null : String(row.display_name),
      username: row.username == null || !String(row.username).trim() ? null : String(row.username),
      observedAt: new Date(String(row.observed_at)), type: row.event_type as GuardianArrival["type"],
    })),
  };
}

export async function getGuardianArrivalSummaryWithDatabase(database: Database) {
  const result = await database.query(`SELECT count(*)::integer AS total,
    count(*) FILTER (WHERE COALESCE((payload->>'observed_at')::timestamptz, created_at)
      >= clock_timestamp() - interval '30 days')::integer AS last_30_days
    FROM events WHERE event_type IN ('forum.joined', 'forum.rejoined')`);
  return { total: Number(result.rows[0]?.total ?? 0), last30Days: Number(result.rows[0]?.last_30_days ?? 0) };
}

export async function getGuardianArrivalSummary() {
  const { pool } = await import("./db");
  return getGuardianArrivalSummaryWithDatabase(pool);
}

export async function getGuardianArrivals() {
  const { pool } = await import("./db");
  return getGuardianArrivalsWithDatabase(pool);
}
