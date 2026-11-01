import { pool } from "./db";

export type CommunicationSummary = {
  score: number;
  hasRatings: boolean;
  viewerSignal: "positive" | "negative" | null;
};

/** Telegram-derived durable balance. Never read the old manual communication signals. */
export async function getCommunicationSummary(subjectId: string, viewerId: string): Promise<CommunicationSummary> {
  const result = await pool.query(`
    SELECT COUNT(*)::int AS rating_count,
      GREATEST(0, COALESCE(SUM(balance),0))::int AS score,
      MAX(CASE WHEN actor_participant_id=$2::uuid THEN balance ELSE NULL END) AS viewer_balance
    FROM communication_reaction_balances
    WHERE subject_participant_id=$1::uuid
  `, [subjectId, viewerId]);
  const row = result.rows[0];
  const viewerBalance = row?.viewer_balance === null || row?.viewer_balance === undefined
    ? 0 : Number(row.viewer_balance);
  return {
    score: Number(row?.score ?? 0),
    hasRatings: Number(row?.rating_count ?? 0) > 0,
    viewerSignal: viewerBalance > 0 ? "positive" : viewerBalance < 0 ? "negative" : null,
  };
}
