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
    `SELECT id FROM telegram_hubs WHERE chat_id=$1 AND enabled`,
    [String(chat.id)],
  );
  if (!hub.rowCount) return false;
  if (id(message?.message_id) && id(author?.id) && author?.is_bot !== true) {
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
  const reaction = object(object(update)?.message_reaction);
  const chat = object(reaction?.chat);
  const actor = object(reaction?.user);
  if (!chatId(chat?.id) || !id(reaction?.message_id) || !id(actor?.id) || actor?.is_bot === true ||
      !Array.isArray(reaction?.new_reaction) || typeof reaction?.date !== "number" ||
      !Number.isSafeInteger(reaction.date) || reaction.date <= 0) return;
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
      await client.query(`
        INSERT INTO telegram_hub_reactions
          (hub_id,message_id,message_author_id,reactor_id,reaction,event_date)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (hub_id,message_id,reactor_id)
        DO UPDATE SET reaction=EXCLUDED.reaction,
                      event_date=EXCLUDED.event_date,
                      updated_at=now()
        WHERE telegram_hub_reactions.event_date < EXCLUDED.event_date
      `, [hub, reaction.message_id, target.rows[0].telegram_user_id,
          String(actor.id), value, reaction.date]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
