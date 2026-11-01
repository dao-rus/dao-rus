import type { ReputationDatabase } from "./reputation";
import { pool } from "./db";
export type CommunicationSummary = {
  score: number;
  hasRatings: boolean;
  viewerSignal: "positive" | "negative" | null;
};

export async function getCommunicationSummaryWithDatabase(
  database: Pick<ReputationDatabase, "query">,
  subjectId: string,
  viewerId: string,
): Promise<CommunicationSummary> {
  const result = await database.query(`
    SELECT COUNT(*)::int AS rating_count,
      GREATEST(0, COALESCE(SUM(balance),0))::int AS score,
      MAX(CASE WHEN actor_participant_id=$2::uuid THEN balance ELSE NULL END) AS viewer_balance
    FROM communication_reaction_balances
    WHERE subject_participant_id=$1::uuid
  `, [subjectId, viewerId]);
  const viewerBalance = result.rows[0]?.viewer_balance === null || result.rows[0]?.viewer_balance === undefined
    ? 0 : Number(result.rows[0].viewer_balance);
  return {
    score: Number(result.rows[0]?.score ?? 0),
    hasRatings: Number(result.rows[0]?.rating_count ?? 0) > 0,
    viewerSignal: viewerBalance > 0 ? "positive" : viewerBalance < 0 ? "negative" : null,
  };
}

export async function getCommunicationSummary(subjectId: string, viewerId: string): Promise<CommunicationSummary> {
  return getCommunicationSummaryWithDatabase(pool, subjectId, viewerId);
}

