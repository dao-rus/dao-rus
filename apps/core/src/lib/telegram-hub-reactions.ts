import { pool } from "./db";

type Obj = Record<string, unknown>;
const object = (v: unknown): Obj | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Obj : null;
const id = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const chatId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v < 0;
const emoji = (v: unknown): "👍" | "👎" | null => v === "👍" || v === "👎" ? v : null;

/**
 * Capture the author of a hub message so later reaction updates can be attributed.
 * Unknown/anonymous authors are intentionally ignored.
 */
export async function observeHubMessage(update: unknown): Promise<boolean> {
  const message = object(object(update)?.message);
  const chat = object(message?.chat);
  const author = object(message?.from);
  if (!chatId(chat?.id)) return false;
  // A configured hub is a hub even when the sender is not in the admission registry.
  // Never route its messages to the private reception relay.
  const hub = await pool.query(
    `SELECT id,enabled FROM telegram_hubs WHERE chat_id=$1`,
    [String(chat.id)],
  );
  if (!hub.rowCount) return false;
  if (hub.rows[0].enabled && id(message?.message_id) && id(author?.id) && author?.is_bot !== true) {
    await pool.query(`
      INSERT INTO telegram_hub_message_authors(hub_id,message_id,telegram_user_id)
      VALUES ($1,$2,$3) ON CONFLICT DO NOTHING
    `, [hub.rows[0].id, message.message_id, String(author.id)]);
  }
  return true;
}

/**
 * Telegram message_reaction supplies the reacting user and full new reaction set.
 * An anonymous chat actor or missing original message author is never counted.
 * This stage only persists reactions; it does not apply moderation sanctions.
 */
export async function observeHubReaction(update: unknown): Promise<void> {
  const root = object(update);
  const reaction = object(root?.message_reaction);
  const chat = object(reaction?.chat);
  const actor = object(reaction?.user);
  if (!chatId(chat?.id) || !id(reaction?.message_id) || !id(actor?.id) || actor?.is_bot === true ||
      !Array.isArray(reaction?.new_reaction) || typeof reaction?.date !== "number" ||
      !Number.isSafeInteger(reaction.date) || reaction.date <= 0 ||
      typeof root?.update_id !== "number" || !Number.isSafeInteger(root.update_id) || root.update_id < 0) return;
  const selected = reaction.new_reaction
    .map((item: unknown) => object(item))
    .filter((item: Obj | null) => item?.type === "emoji")
    .map((item: Obj | null) => emoji(item?.emoji))
    .filter((item: string | null): item is "👍" | "👎" => item !== null);
  // Telegram may allow multiple reactions. Treat mixed 👍/👎 as no unambiguous evaluation.
  const value = selected.length === 1 ? selected[0] : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize updates for one actor/message to avoid concurrent insert races.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`${chat.id}:${reaction.message_id}:${actor.id}`]);
    const target = await client.query(`
      SELECT a.hub_id, a.telegram_user_id
      FROM telegram_hub_message_authors a
      JOIN telegram_hubs h ON h.id=a.hub_id AND h.enabled
      JOIN telegram_hub_memberships m ON m.hub_id=a.hub_id AND m.telegram_user_id=$3
      WHERE h.chat_id=$1 AND a.message_id=$2
    `, [String(chat.id), reaction.message_id, String(actor.id)]);
    if (target.rowCount && target.rows[0].telegram_user_id !== String(actor.id)) {
      const hub = target.rows[0].hub_id as string;
      // Persist removals as tombstones. Ignore older events even if delivered later.
      // Snapshot the previous state while holding the message/actor advisory lock.
      // A repeated delivery or a new update with unchanged reaction is not a new vote.
      const previous = await client.query(`
        SELECT reaction, telegram_update_id FROM telegram_hub_reactions
        WHERE hub_id=$1 AND message_id=$2 AND reactor_id=$3
      `, [hub, reaction.message_id, String(actor.id)]);
      const oldState = previous.rows[0];
      const fresh = !oldState || Number(oldState.telegram_update_id) < root.update_id;
      if (fresh) {
        await client.query(`
          INSERT INTO telegram_hub_reactions
            (hub_id,message_id,message_author_id,reactor_id,reaction,event_date,telegram_update_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (hub_id,message_id,reactor_id)
          DO UPDATE SET reaction=EXCLUDED.reaction,
                        event_date=EXCLUDED.event_date,
                        telegram_update_id=EXCLUDED.telegram_update_id,
                        updated_at=now()
          WHERE telegram_hub_reactions.telegram_update_id < EXCLUDED.telegram_update_id
        `, [hub, reaction.message_id, target.rows[0].telegram_user_id,
            String(actor.id), value, reaction.date, root.update_id]);

        // Explicit opt-in: no historical backfill and no automatic activation on deploy.
        if (process.env.TELEGRAM_COMMUNICATION_REPUTATION_ENABLED === "true" &&
            value !== null && oldState?.reaction !== value) {
          const identities = await client.query(`
            SELECT reactor.participant_id AS actor_id, author.participant_id AS subject_id
            FROM telegram_hub_memberships reactor
            JOIN telegram_hub_memberships author ON author.hub_id=reactor.hub_id
              AND author.telegram_user_id=$3
            WHERE reactor.hub_id=$1 AND reactor.telegram_user_id=$2
          `, [hub, String(actor.id), target.rows[0].telegram_user_id]);
          if (identities.rowCount && identities.rows[0].actor_id !== identities.rows[0].subject_id) {
            const { actor_id: actorId, subject_id: subjectId } = identities.rows[0];
            // Keep a durable, globally ordered transition ledger. Applying a
            // saturating +/-1 directly here would make the result depend on
            // webhook lock acquisition order across messages and hubs.
            const delta = value === "👍" ? 1 : -1;
            const recorded = await client.query(`
              INSERT INTO communication_reaction_events
                (telegram_update_id,hub_id,message_id,actor_participant_id,subject_participant_id,delta)
              VALUES ($1,$2,$3,$4::uuid,$5::uuid,$6)
              ON CONFLICT (telegram_update_id) DO NOTHING
              RETURNING telegram_update_id
            `, [root.update_id, hub, reaction.message_id, actorId, subjectId, delta]);
            if (recorded.rowCount) {
              await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                [`communication:${actorId}:${subjectId}`]);
              const balanceRow = await client.query(`
                SELECT balance,last_telegram_update_id FROM communication_reaction_balances
                WHERE actor_participant_id=$1::uuid AND subject_participant_id=$2::uuid
                FOR UPDATE
              `, [actorId, subjectId]);
              let balance: number;
              let lastUpdateId = root.update_id;
              if (!balanceRow.rowCount || root.update_id > Number(balanceRow.rows[0].last_telegram_update_id)) {
                balance = Math.max(-1, Math.min(1, Number(balanceRow.rows[0]?.balance ?? 0) + delta));
              } else {
                // A lower update_id committed late. Re-fold this pair in Telegram
                // order because saturating addition is not commutative.
                const transitions = await client.query(`
                  SELECT telegram_update_id,delta FROM communication_reaction_events
                  WHERE actor_participant_id=$1::uuid AND subject_participant_id=$2::uuid
                  ORDER BY telegram_update_id
                `, [actorId, subjectId]);
                balance = transitions.rows.reduce((current, row) =>
                  Math.max(-1, Math.min(1, current + Number(row.delta))), 0);
                lastUpdateId = Math.max(...transitions.rows.map((row) => Number(row.telegram_update_id)));
              }
              await client.query(`
                INSERT INTO communication_reaction_balances
                  (actor_participant_id,subject_participant_id,balance,last_telegram_update_id)
                VALUES ($1::uuid,$2::uuid,$3,$4)
                ON CONFLICT (actor_participant_id,subject_participant_id)
                DO UPDATE SET balance=EXCLUDED.balance,
                              last_telegram_update_id=EXCLUDED.last_telegram_update_id,
                              updated_at=clock_timestamp()
              `, [actorId, subjectId, balance, lastUpdateId]);
            }
          }
        }
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
