import type { Pool } from "pg";
import { ReputationValidationError, type ReputationDatabase } from "./reputation";

export type CommunicationAction = "positive" | "negative" | "revoke";
export type CommunicationSummary = {
  score: number;
  hasRatings: boolean;
  viewerSignal: "positive" | "negative" | null;
};

/** A deliberate evaluation of a participant, not a Telegram message reaction. */
export async function setCommunicationSignalWithDatabase(
  database: ReputationDatabase,
  actorId: string,
  subjectId: string,
  action: CommunicationAction,
): Promise<"created" | "changed" | "revoked" | "unchanged"> {
  if (actorId === subjectId) throw new ReputationValidationError("Cannot rate yourself");
  if (!["positive", "negative", "revoke"].includes(action)) {
    throw new ReputationValidationError("Invalid communication action");
  }
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const actor = await client.query("SELECT id FROM participants WHERE id=$1::uuid FOR UPDATE", [actorId]);
    if (!actor.rowCount) throw new ReputationValidationError("Actor not found");
    const subject = await client.query("SELECT id FROM participants WHERE id=$1::uuid", [subjectId]);
    if (!subject.rowCount) throw new ReputationValidationError("Subject not found");
    const active = await client.query(`
      SELECT id,signal_type FROM reputation_signals
      WHERE actor_participant_id=$1::uuid AND subject_participant_id=$2::uuid
        AND dimension='communication' AND revoked_at IS NULL FOR UPDATE
    `, [actorId, subjectId]);
    const previous = active.rows[0];
    if ((!previous && action === "revoke") || previous?.signal_type === action) {
      await client.query("COMMIT");
      return "unchanged";
    }
    if (previous) {
      // now() is fixed at transaction start and may predate a signal created
      // while this transaction waited on the actor row lock.
      await client.query("UPDATE reputation_signals SET revoked_at=GREATEST(clock_timestamp(),created_at) WHERE id=$1::uuid", [previous.id]);
    }
    const inserted = action === "revoke" ? null : await client.query(`
      INSERT INTO reputation_signals(actor_participant_id,subject_participant_id,dimension,signal_type)
      VALUES ($1::uuid,$2::uuid,'communication',$3) RETURNING id
    `, [actorId, subjectId, action]);
    const outcome = action === "revoke" ? "revoked" : previous ? "changed" : "created";
    await client.query(`
      INSERT INTO events(event_type,participant_id,payload)
      VALUES ($1,$2::uuid,$3::jsonb)
    `, [`reputation.communication_${outcome}`, actorId, JSON.stringify({
      subject_participant_id: subjectId,
      previous_signal_id: previous?.id ?? null,
      signal_id: inserted?.rows[0]?.id ?? null,
      signal_type: action === "revoke" ? null : action,
    })]);
    await client.query("COMMIT");
    return outcome;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function getCommunicationSummaryWithDatabase(
  database: Pick<ReputationDatabase, "query">,
  subjectId: string,
  viewerId: string,
): Promise<CommunicationSummary> {
  const result = await database.query(`
    SELECT COUNT(*)::int AS rating_count,
      GREATEST(0, COALESCE(SUM(CASE signal_type WHEN 'positive' THEN 1 ELSE -1 END),0))::int AS score,
      MAX(CASE WHEN actor_participant_id=$2::uuid THEN signal_type ELSE NULL END) AS viewer_signal
    FROM reputation_signals
    WHERE subject_participant_id=$1::uuid AND dimension='communication' AND revoked_at IS NULL
  `, [subjectId, viewerId]);
  return {
    score: Number(result.rows[0]?.score ?? 0),
    hasRatings: Number(result.rows[0]?.rating_count ?? 0) > 0,
    viewerSignal: (result.rows[0]?.viewer_signal as CommunicationSummary["viewerSignal"]) ?? null,
  };
}

export async function setCommunicationSignal(actorId: string, subjectId: string, action: CommunicationAction) {
  const { pool } = await import("./db");
  return setCommunicationSignalWithDatabase(pool as Pool, actorId, subjectId, action);
}

export async function getCommunicationSummary(subjectId: string, viewerId: string) {
  const { pool } = await import("./db");
  return getCommunicationSummaryWithDatabase(pool, subjectId, viewerId);
}
