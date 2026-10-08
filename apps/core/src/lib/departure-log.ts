import { departureHandle, departureName } from "./departure-names";
import { getGuardianDeparturesWithDatabase } from "./guardian-departures";
import { clipForumText, featureEnabled, ForumBotError, type GuardianSettings } from "./guardian-forum";
import type { InterfaceTextValues } from "./interface-texts";
import type { SignalDatabase } from "./signals";

// Guardian keeps the departures channel up to date: one text line for every person who left the forum
// by themselves. Removals by an administrator are not written there. Failing to write never loses the
// departure itself: it is already in the history, and a message is claimed before it is sent.
export type ChannelSender = (text: string) => Promise<number>;
export type DepartureLogDeps = { database: SignalDatabase; send: ChannelSender; settings: GuardianSettings; texts: InterfaceTextValues };

const day = (date: Date) => date.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric" });
const longDay = (date: Date) => date.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "long" });

export function channelSender(token: string, channelId: string, request: typeof fetch = fetch): ChannelSender {
  return async (text) => {
    let response: Response;
    try {
      response = await request(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: Number(channelId), text: clipForumText(text), link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new ForumBotError("Telegram не ответил"); }
    const data = await response.json().catch(() => null) as { ok?: boolean; description?: string; result?: { message_id?: unknown } } | null;
    if (!data || data.ok !== true) throw new ForumBotError(typeof data?.description === "string" ? data.description : `HTTP ${response.status}`);
    const id = data.result?.message_id;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw new ForumBotError("Telegram не вернул номер сообщения");
    return id;
  };
}

export async function logDepartureWithDatabase(deps: DepartureLogDeps, eventId: string): Promise<"none" | "logged"> {
  if (!featureEnabled(deps.settings, "departure_log") || !deps.settings.get("channel.departures")) return "none";
  const { events } = await getGuardianDeparturesWithDatabase(deps.database, eventId);
  const event = events[0];
  if (!event || event.type !== "forum.left") return "none";
  const joined = event.joinedAt ? `${deps.texts["profile.forum_since"]} ${longDay(event.joinedAt)}` : null;
  const text = [day(event.observedAt), departureName(event) ?? deps.texts["guardian.profile_unavailable"], departureHandle(event), joined,
    deps.texts["profile.left_forum"]].filter(Boolean).join(" · ");
  // Claim first, so a repeated Telegram update cannot write the same departure twice.
  const claim = await deps.database.query(
    `INSERT INTO departure_log_posts AS post(event_id) VALUES ($1::bigint)
     ON CONFLICT (event_id) DO UPDATE SET claimed_at = now()
       WHERE post.message_id IS NULL AND post.claimed_at < now() - interval '60 seconds'
     RETURNING event_id`, [eventId]);
  if (!claim.rowCount) return "none";
  try {
    const messageId = await deps.send(text);
    await deps.database.query("UPDATE departure_log_posts SET message_id = $2 WHERE event_id = $1::bigint", [eventId, messageId]);
  } catch (error) {
    await deps.database.query("DELETE FROM departure_log_posts WHERE event_id = $1::bigint AND message_id IS NULL", [eventId]);
    throw error;
  }
  return "logged";
}

// Production wiring for the webhook: finds the departure recorded for this exact Telegram update.
export async function logDepartureAfterUpdate(update: unknown): Promise<void> {
  try {
    const member = (update as { update_id?: unknown; chat_member?: { new_chat_member?: { status?: unknown; user?: { id?: unknown } } } });
    const userId = member?.chat_member?.new_chat_member?.user?.id;
    if (member?.chat_member?.new_chat_member?.status !== "left" || typeof userId !== "number" || !Number.isSafeInteger(userId)
      || typeof member.update_id !== "number") return;
    const [{ pool }, { telegramBotToken }, { readGuardianSettings }, { readInterfaceTexts }] = await Promise.all([
      import("./db"), import("./config"), import("./guardian-forum"), import("./interface-texts")]);
    const token = telegramBotToken(), settings = await readGuardianSettings(), channelId = settings.get("channel.departures");
    if (!token || !channelId) return;
    const found = await pool.query(
      `SELECT event.id FROM events event JOIN external_identities identity ON identity.participant_id = event.participant_id
        WHERE identity.provider = 'telegram' AND identity.external_user_id = $1 AND event.event_type = 'forum.left'
          AND event.payload->>'telegram_update_id' = $2 ORDER BY event.id DESC LIMIT 1`, [String(userId), String(member.update_id)]);
    if (!found.rowCount) return;
    const { values: texts } = await readInterfaceTexts();
    await logDepartureWithDatabase({ database: pool, send: channelSender(token, channelId), settings, texts }, String(found.rows[0].id));
  } catch (error) { console.error("Departure log failed", error); }
}
