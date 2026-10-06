import { pool } from "./db";
import type { SignalDatabase } from "./signals";

export type AngelRiskCategory = "out_of_scope" | "suspicious_prompt" | "invalid_model_output" | "provider_failure" | "rate_limit";
const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 60;

export async function recordAngelRisk(participantId: string, category: AngelRiskCategory, operation: string) {
  await pool.query(
    "INSERT INTO events(event_type, participant_id, payload) VALUES ($1, $2::uuid, $3::jsonb)",
    [`angel.${category}`, participantId, JSON.stringify({ operation, category })],
  );
}

// The lock makes the count-and-record operation effective across concurrent requests
// in one PostgreSQL database. Only an operation name is recorded: never the request text.
export async function allowAngelRequestWithDatabase(database: SignalDatabase, participantId: string, operation: "compose_signal" | "search_exchange"): Promise<boolean> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`angel:${participantId}`]);
    const clock = await client.query("SELECT clock_timestamp() AS checked_at");
    const checkedAt = clock.rows[0].checked_at;
    const recent = await client.query(
      `SELECT count(*)::int AS count FROM events
        WHERE participant_id = $1::uuid AND event_type = 'angel.request'
          AND created_at >= $3::timestamptz - ($2::text || ' seconds')::interval`,
      [participantId, String(RATE_WINDOW_SECONDS), checkedAt],
    );
    const allowed = Number(recent.rows[0]?.count ?? 0) < RATE_LIMIT;
    // Keep one rate rejection per participant/window; flooding an exhausted quota
    // must not grow the audit log without bound. Both checks use the post-lock clock.
    await client.query(
      `INSERT INTO events(event_type, participant_id, payload, created_at)
       SELECT $1, $2::uuid, $3::jsonb, $4::timestamptz
        WHERE $1 = 'angel.request' OR NOT EXISTS (
          SELECT 1 FROM events WHERE participant_id = $2::uuid AND event_type = 'angel.rate_limit'
            AND created_at >= $4::timestamptz - ($5::text || ' seconds')::interval
        )`,
      [allowed ? "angel.request" : "angel.rate_limit", participantId, JSON.stringify({ operation, ...(allowed ? {} : { category: "rate_limit" }) }), checkedAt, String(RATE_WINDOW_SECONDS)],
    );
    await client.query("COMMIT");
    return allowed;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original error. */ }
    throw error;
  } finally { client.release(); }
}

export function allowAngelRequest(participantId: string, operation: "compose_signal" | "search_exchange") {
  return allowAngelRequestWithDatabase(pool, participantId, operation);
}
