import { pool } from "./db";

export type HubReactionCounts = {
  positive: number;
  negative: number;
  warningThresholdReached: boolean;
  muteThresholdReached: boolean;
};

/**
 * Counts distinct current hub members, not reaction events.
 * A participant's multiple reactions to the same author count once per polarity.
 * This is a read-only decision input: it does not issue Telegram sanctions.
 */
export async function countHubReactions(
  hubId: string,
  targetTelegramId: string,
  now: Date = new Date(),
): Promise<HubReactionCounts> {
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(hubId) ||
      !/^[1-9][0-9]{0,15}$/.test(targetTelegramId) ||
      !Number.isFinite(now.getTime())) {
    throw new Error("Invalid hub, target or time");
  }
  const result = await pool.query(
    `SELECT
       COUNT(DISTINCT r.reactor_id) FILTER (WHERE r.reaction = '👍')::int AS positive,
       COUNT(DISTINCT r.reactor_id) FILTER (WHERE r.reaction = '👎')::int AS negative
     FROM telegram_hub_reactions r
     JOIN telegram_hub_memberships voter
       ON voter.hub_id = r.hub_id AND voter.telegram_user_id = r.reactor_id
     JOIN telegram_hub_memberships target
       ON target.hub_id = r.hub_id AND target.telegram_user_id = r.message_author_id
     WHERE r.hub_id = $1
       AND r.message_author_id = $2
       AND r.reactor_id <> r.message_author_id
       AND r.event_date >= floor(extract(epoch FROM $3::timestamptz - interval '24 hours'))
       AND r.event_date <= floor(extract(epoch FROM $3::timestamptz))`,
    [hubId, targetTelegramId, now.toISOString()],
  );
  const positive = Number(result.rows[0]?.positive ?? 0);
  const negative = Number(result.rows[0]?.negative ?? 0);
  return {
    positive,
    negative,
    warningThresholdReached: negative >= 5,
    muteThresholdReached: negative >= 10,
  };
}

/**
 * Read-only status of the explicit safety gates. Do not treat a database flag
 * alone as evidence that Telegram has been tested in the live chat.
 */
export async function hubModerationConfigured(hubId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT enabled AND actor_attribution_verified
                AND telegram_restriction_verified AS ready
     FROM telegram_hub_moderation_config WHERE hub_id = $1`,
    [hubId],
  );
  return result.rows[0]?.ready === true;
}
