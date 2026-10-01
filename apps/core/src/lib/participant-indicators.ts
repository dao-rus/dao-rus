import { pool } from "./db";
import { VERIFIED_SUBJECTS_CTE } from "./verification";

export type ParticipantIndicators = { verificationPoints: number; positiveCount: number };
type IndicatorDatabase = { query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> };

export async function getParticipantIndicatorsWithDatabase(
  database: IndicatorDatabase, ids: string[],
): Promise<Map<string, ParticipantIndicators>> {
  if (!ids.length) return new Map();
  const result = await database.query(
    `${VERIFIED_SUBJECTS_CTE}
     SELECT p.id,
            (SELECT count(*)::integer FROM verification_attestations a
              JOIN verified v ON v.subject_id = a.verifier_subject_id
              WHERE a.subject_id = p.id AND a.revoked_at IS NULL) AS verification_points,
            (SELECT count(*)::integer FROM reputation_signals r
              WHERE r.subject_participant_id = p.id AND r.dimension = 'interaction_quality'
                AND r.signal_type = 'positive' AND r.revoked_at IS NULL) AS positive_count
       FROM participants p WHERE p.id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(result.rows.map((row) => [String(row.id), {
    verificationPoints: Number(row.verification_points), positiveCount: Number(row.positive_count),
  }]));
}

export async function getParticipantIndicators(ids: string[]): Promise<Map<string, ParticipantIndicators>> {
  return getParticipantIndicatorsWithDatabase(pool, ids);
}
