import type { Pool } from "pg";

export type ReputationSignalType = "positive" | "quality_flag";
export type ReputationAction = "positive" | "quality_flag" | "revoke";

type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
type DatabaseClient = { query(text: string, values?: unknown[]): Promise<QueryResult>; release(): void };
export type ReputationDatabase = { connect(): Promise<DatabaseClient>; query(text: string, values?: unknown[]): Promise<QueryResult> };

export class ReputationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReputationValidationError";
  }
}

export function parseReputationAction(value: unknown): ReputationAction {
  if (value === "positive" || value === "quality_flag" || value === "revoke") return value;
  throw new ReputationValidationError("Invalid reputation action");
}

export async function setReputationSignalWithDatabase(
  database: ReputationDatabase,
  actorId: string,
  subjectId: string,
  action: ReputationAction,
): Promise<"created" | "changed" | "revoked" | "unchanged"> {
  if (actorId === subjectId) throw new ReputationValidationError("Cannot rate yourself");
  parseReputationAction(action);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    // Serialize all changes made by this actor, including a first signal for this pair.
    const actor = await client.query("SELECT id FROM participants WHERE id = $1::uuid FOR UPDATE", [actorId]);
    if (!actor.rowCount) throw new ReputationValidationError("Actor not found");
    const subject = await client.query("SELECT id FROM participants WHERE id = $1::uuid", [subjectId]);
    if (!subject.rowCount) throw new ReputationValidationError("Subject not found");

    const active = await client.query(
      `SELECT id, signal_type FROM reputation_signals
        WHERE actor_participant_id = $1::uuid AND subject_participant_id = $2::uuid
          AND dimension = 'interaction_quality' AND revoked_at IS NULL
        FOR UPDATE`,
      [actorId, subjectId],
    );
    const old = active.rows[0];
    if ((!old && action === "revoke") || old?.signal_type === action) {
      await client.query("COMMIT");
      return "unchanged";
    }

    if (old) {
      await client.query("UPDATE reputation_signals SET revoked_at = now() WHERE id = $1::uuid", [old.id]);
    }
    const created = action === "revoke" ? null : await client.query(
      `INSERT INTO reputation_signals(actor_participant_id, subject_participant_id, dimension, signal_type)
       VALUES ($1::uuid, $2::uuid, 'interaction_quality', $3)
       RETURNING id`,
      [actorId, subjectId, action],
    );
    const outcome = action === "revoke" ? "revoked" : old ? "changed" : "created";
    await client.query(
      `INSERT INTO events(event_type, participant_id, payload)
       VALUES ($1, $2::uuid, $3::jsonb)`,
      [
        `reputation.signal_${outcome}`,
        actorId,
        JSON.stringify({
          subject_participant_id: subjectId,
          dimension: "interaction_quality",
          previous_signal_id: old?.id ?? null,
          signal_id: created?.rows[0]?.id ?? null,
          signal_type: action === "revoke" ? null : action,
        }),
      ],
    );
    await client.query("COMMIT");
    return outcome;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original error. */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function setReputationSignal(actorId: string, subjectId: string, action: ReputationAction) {
  const { pool } = await import("./db");
  return setReputationSignalWithDatabase(pool as Pool, actorId, subjectId, action);
}

export type ReputationSummary = { positiveCount: number; viewerSignal: ReputationSignalType | null };

export async function getReputationSummaryWithDatabase(
  database: Pick<ReputationDatabase, "query">,
  subjectId: string,
  viewerId: string,
): Promise<ReputationSummary> {
  const result = await database.query(
    `SELECT
       (SELECT count(*)::int FROM reputation_signals
         WHERE subject_participant_id = $1::uuid AND dimension = 'interaction_quality'
           AND signal_type = 'positive' AND revoked_at IS NULL) AS positive_count,
       (SELECT signal_type FROM reputation_signals
         WHERE actor_participant_id = $2::uuid AND subject_participant_id = $1::uuid
           AND dimension = 'interaction_quality' AND revoked_at IS NULL) AS viewer_signal`,
    [subjectId, viewerId],
  );
  return {
    positiveCount: Number(result.rows[0].positive_count),
    viewerSignal: (result.rows[0].viewer_signal as ReputationSignalType | null) ?? null,
  };
}

export async function getReputationSummary(subjectId: string, viewerId: string) {
  const { pool } = await import("./db");
  return getReputationSummaryWithDatabase(pool, subjectId, viewerId);
}

export type ReputationHistoryEntry = {
  id: string;
  actorId: string;
  actorName: string;
  subjectId: string;
  subjectName: string;
  signalType: ReputationSignalType;
  createdAt: Date;
  revokedAt: Date | null;
};

export async function getReputationHistoryWithDatabase(database: Pick<ReputationDatabase, "query">): Promise<ReputationHistoryEntry[]> {
  const result = await database.query(
    `SELECT signal.id, signal.actor_participant_id, actor.display_name AS actor_name,
            signal.subject_participant_id, subject.display_name AS subject_name,
            signal.signal_type, signal.created_at, signal.revoked_at
       FROM reputation_signals signal
       JOIN participants actor ON actor.id = signal.actor_participant_id
       JOIN participants subject ON subject.id = signal.subject_participant_id
      WHERE signal.dimension = 'interaction_quality'
      ORDER BY signal.created_at DESC, signal.id DESC`,
  );
  return result.rows.map((row) => ({
    id: String(row.id), actorId: String(row.actor_participant_id), actorName: String(row.actor_name),
    subjectId: String(row.subject_participant_id), subjectName: String(row.subject_name),
    signalType: row.signal_type as ReputationSignalType,
    createdAt: new Date(row.created_at as string), revokedAt: row.revoked_at ? new Date(row.revoked_at as string) : null,
  }));
}

export async function getReputationHistory() {
  const { pool } = await import("./db");
  return getReputationHistoryWithDatabase(pool);
}
