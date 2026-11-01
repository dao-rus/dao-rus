import { pool } from "./db";

const userId = (value: string) => /^[1-9][0-9]{0,15}$/.test(value);
const hubId = (value: string) => /^[a-z0-9][a-z0-9_-]{1,63}$/.test(value);
type VoteOutcome = "open" | "passed" | "rejected" | "cancelled";

/**
 * Creates an exclusion vote with a frozen electorate, including the target
 * if the target is a registered hub member. No Telegram action is taken.
 * Requires three recorded mutes in the last 30 days before opening.
 */
export async function openHubExclusionVote(hub: string, target: string): Promise<string> {
  if (!hubId(hub) || !userId(target)) throw new Error("Invalid hub or target");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`hub-vote:${hub}:${target}`]);
    const existing = await client.query(
      `SELECT id FROM telegram_hub_exclusion_votes
       WHERE hub_id=$1 AND target_user_id=$2 AND status='open'`, [hub,target]);
    if (existing.rowCount) {
      await client.query("COMMIT");
      return String(existing.rows[0].id);
    }
    const eligibility = await client.query(
      `SELECT COUNT(*)::int AS mutes FROM telegram_hub_moderation_events
       WHERE hub_id=$1 AND target_user_id=$2 AND kind='mute'
         AND created_at >= now() - interval '30 days'
         AND created_at > COALESCE(
           (SELECT MAX(opened_at) FROM telegram_hub_exclusion_votes
            WHERE hub_id=$1 AND target_user_id=$2),
           '-infinity'::timestamptz
         )`, [hub,target]);
    if (Number(eligibility.rows[0]?.mutes ?? 0) < 3) {
      throw new Error("Three mutes within 30 days are required");
    }
    const targetMembership = await client.query(
      `SELECT 1 FROM telegram_hub_memberships
       WHERE hub_id=$1 AND telegram_user_id=$2`, [hub,target]);
    if (!targetMembership.rowCount) throw new Error("Target is not a hub member");
    const electorate = await client.query(
      `SELECT m.telegram_user_id FROM telegram_hub_memberships m
       JOIN telegram_hubs h ON h.id=m.hub_id AND h.enabled
       WHERE m.hub_id=$1 ORDER BY m.telegram_user_id`, [hub]);
    if (!electorate.rowCount) throw new Error("No eligible hub members");
    const inserted = await client.query(
      `INSERT INTO telegram_hub_exclusion_votes
         (hub_id,target_user_id,closes_at,eligible_count)
       VALUES ($1,$2,now()+interval '7 days',$3) RETURNING id`,
      [hub,target,electorate.rowCount]);
    const voteId = String(inserted.rows[0].id);
    const frozen = await client.query(
      `INSERT INTO telegram_hub_exclusion_electorate(vote_id,telegram_user_id)
       SELECT $1::uuid, m.telegram_user_id
       FROM telegram_hub_memberships m
       JOIN telegram_hubs h ON h.id=m.hub_id AND h.enabled
       WHERE m.hub_id=$2`, [voteId,hub]);
    // Membership may change between the count and insertion. Never store
    // a majority threshold that differs from the actual frozen electorate.
    if (frozen.rowCount !== electorate.rowCount) {
      throw new Error("Hub membership changed while opening the vote; retry");
    }
    await client.query("COMMIT");
    return voteId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/** A vote may be changed until closure. A passed result is recorded, not enforced. */
export async function castHubExclusionVote(
  voteId: string, voter: string, yes: boolean,
): Promise<{ status: VoteOutcome; yes: number; requiredYes: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(voteId) || !userId(voter)) throw new Error("Invalid vote or voter");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const vote = await client.query(
      `SELECT status,required_yes,closes_at FROM telegram_hub_exclusion_votes
       WHERE id=$1::uuid FOR UPDATE`, [voteId]);
    if (!vote.rowCount || vote.rows[0].status !== "open" ||
        new Date(vote.rows[0].closes_at).getTime() <= Date.now()) {
      throw new Error("Vote is closed or expired");
    }
    const changed = await client.query(
      `UPDATE telegram_hub_exclusion_electorate
       SET choice=$3,voted_at=now()
       WHERE vote_id=$1::uuid AND telegram_user_id=$2 RETURNING telegram_user_id`,
      [voteId,voter,yes]);
    if (!changed.rowCount) throw new Error("Voter not in frozen electorate");
    const tally = await client.query(
      `SELECT COUNT(*)::int AS yes FROM telegram_hub_exclusion_electorate
       WHERE vote_id=$1::uuid AND choice=true`, [voteId]);
    const yesCount = Number(tally.rows[0].yes);
    const requiredYes = Number(vote.rows[0].required_yes);
    const status: VoteOutcome = yesCount >= requiredYes ? "passed" : "open";
    if (status === "passed") {
      await client.query(
        `UPDATE telegram_hub_exclusion_votes
         SET status='passed',closed_at=now() WHERE id=$1::uuid`, [voteId]);
    }
    await client.query("COMMIT");
    return { status, yes: yesCount, requiredYes };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/** Closes expired votes without banning anyone; caller may inspect results. */
export async function closeExpiredHubExclusionVotes(): Promise<number> {
  const result = await pool.query(
    `UPDATE telegram_hub_exclusion_votes
     SET status='rejected',closed_at=now()
     WHERE id IN (
       SELECT id FROM telegram_hub_exclusion_votes
       WHERE status='open' AND closes_at<=now()
       ORDER BY closes_at FOR UPDATE SKIP LOCKED LIMIT 100
     ) RETURNING id`,
  );
  return result.rowCount ?? 0;
}
