import { encodeStartPath } from "./mini-app-start";
import { SignalValidationError, type SignalDatabase, type SignalReader } from "./signals";

// Guardian's routes between Core and the Telegram forum. Every function has a switch
// in /admin/guardian/forum; an unset switch means "on".
export const GUARDIAN_FEATURES = ["departure_log", "exchange_discussion", "forum_buttons", "newcomer_announcements", "notification_mini_app",
  "reception_greeting", "reception_welcome"] as const;
export type GuardianFeature = (typeof GUARDIAN_FEATURES)[number];
export type GuardianSettings = Map<string, string>;
export type ForumButton = { text: string; url: string };

export class GuardianForumValidationError extends SignalValidationError {
  constructor(message = "Invalid Guardian forum setting") { super(message); this.name = "GuardianForumValidationError"; }
}
export class ForumBotError extends Error {
  constructor(public readonly detail: string) { super("Telegram forum request failed"); this.name = "ForumBotError"; }
}

export async function readGuardianSettingsWithDatabase(database: SignalReader): Promise<GuardianSettings> {
  const result = await database.query("SELECT key, value FROM guardian_settings");
  return new Map(result.rows.map((row) => [String(row.key), String(row.value)]));
}
export const featureEnabled = (settings: GuardianSettings, feature: GuardianFeature) => settings.get(`feature.${feature}`) !== "off";
export const discussionTopicKey = (typeKey: string) => `topic.discussion.${typeKey}`;
export function topicFor(settings: GuardianSettings, key: string): number | null {
  const value = Number(settings.get(key));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

// "-1001725482832" (Bot API) ↔ "1725482832" (t.me/c links).
export function forumInternalId(forumChatId: string | undefined): string | null {
  const match = /^-100(\d{5,20})$/u.exec(forumChatId?.trim() ?? "");
  return match ? match[1] : null;
}
export function forumMessageLink(forumChatId: string | undefined, topicId: number, messageId?: number): string | null {
  const internal = forumInternalId(forumChatId);
  return internal ? `https://t.me/c/${internal}/${topicId}${messageId ? `/${messageId}` : ""}` : null;
}

// Accepts the "copy topic link" value of this forum only, or a bare topic number. Empty clears the route.
export function parseTopicLink(value: unknown, forumChatId: string | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new GuardianForumValidationError();
  const text = value.trim();
  if (!text) return null;
  let topic: string | undefined;
  if (/^\d{1,15}$/u.test(text)) topic = text;
  else {
    const match = /^https:\/\/t\.me\/c\/(\d{5,20})\/(\d{1,15})(?:\/\d{1,15})?(?:\?.*)?$/u.exec(text);
    if (!match || match[1] !== forumInternalId(forumChatId)) throw new GuardianForumValidationError("Topic link is not from this forum");
    topic = match[2];
  }
  const id = Number(topic);
  if (!Number.isSafeInteger(id) || id <= 0) throw new GuardianForumValidationError();
  return id;
}

export function normalizeBotUsername(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new GuardianForumValidationError();
  const name = value.trim().replace(/^@/u, "").replace(/^https:\/\/t\.me\//u, "");
  if (!name) return null;
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/u.test(name)) throw new GuardianForumValidationError("Invalid bot username");
  return name;
}

// A button under a forum message: inside Telegram through the bot's main Mini App when that is
// configured and switched on, otherwise the ordinary Core address.
export function coreButtonUrl(path: string, settings: GuardianSettings, baseUrl: string): string {
  const bot = settings.get("miniapp.bot");
  return bot && featureEnabled(settings, "forum_buttons")
    ? `https://t.me/${bot}?startapp=${encodeStartPath(path)}` : new URL(path, baseUrl).toString();
}

export type GuardianForumSettingsInput = {
  features: Record<GuardianFeature, boolean>; botUsername: string | null; topics: Record<string, number | null>;
  // Bot API number of the departures channel ("-100…"); left out means "do not touch".
  departuresChannel?: string | null;
};
// The channel is private, so Telegram knows it by number only: accept "-100…" or a t.me/c/… link.
export function parseChannelId(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  const match = /^-100(\d{5,20})$/u.exec(text) ?? /^https?:\/\/t\.me\/c\/(\d{5,20})(?:\/|$)/u.exec(text);
  return match ? `-100${match[1]}` : null;
}
export async function saveGuardianForumSettingsWithDatabase(
  database: SignalDatabase, actorId: string, input: GuardianForumSettingsInput,
): Promise<string[]> {
  const desired = new Map<string, string | null>();
  for (const feature of GUARDIAN_FEATURES) desired.set(`feature.${feature}`, input.features[feature] ? null : "off");
  desired.set("miniapp.bot", input.botUsername);
  if (input.departuresChannel !== undefined) desired.set("channel.departures", input.departuresChannel);
  for (const [key, topic] of Object.entries(input.topics)) {
    if (!/^topic\.(?:newcomers|veche|discussion\.[a-z][a-z0-9_]{0,63})$/u.test(key)) throw new GuardianForumValidationError();
    desired.set(key, topic === null ? null : String(topic));
  }
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE guardian_settings IN SHARE ROW EXCLUSIVE MODE");
    const current = await readGuardianSettingsWithDatabase(client);
    const changed: string[] = [];
    for (const [key, value] of desired) {
      if ((current.get(key) ?? null) === value) continue;
      if (value === null) await client.query("DELETE FROM guardian_settings WHERE key = $1", [key]);
      else await client.query(
        `INSERT INTO guardian_settings(key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, value]);
      changed.push(key);
    }
    if (changed.length) await client.query(
      `INSERT INTO events(event_type, participant_id, payload) VALUES ('guardian.forum_settings_updated', $1::uuid, $2::jsonb)`,
      [actorId, JSON.stringify({ changed_by_participant_id: actorId, keys: changed })]);
    await client.query("COMMIT");
    return changed;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original error. */ }
    throw error;
  } finally { client.release(); }
}

// The only place that talks to Telegram about forum messages. Text is sent as plain text:
// user content is never interpreted as markup.
export type ForumBot = {
  send(topicId: number, text: string, buttons: ForumButton[]): Promise<number>;
  edit(messageId: number, text: string, buttons: ForumButton[]): Promise<void>;
};
const TELEGRAM_TEXT_LIMIT = 4096;
export function clipForumText(text: string): string {
  return text.length <= TELEGRAM_TEXT_LIMIT ? text : text.slice(0, TELEGRAM_TEXT_LIMIT - 1) + "…";
}
export function telegramForumBot(token: string, forumChatId: string, request: typeof fetch = fetch): ForumBot {
  async function call(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await request(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: Number(forumChatId), link_preview_options: { is_disabled: true }, ...body }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new ForumBotError("Telegram не ответил"); }
    const data = await response.json().catch(() => null) as { ok?: boolean; description?: string; result?: Record<string, unknown> } | null;
    if (!data || data.ok !== true) throw new ForumBotError(typeof data?.description === "string" ? data.description : `HTTP ${response.status}`);
    return data.result ?? {};
  }
  const markup = (buttons: ForumButton[]) => buttons.length ? { reply_markup: { inline_keyboard: [buttons] } } : { reply_markup: { inline_keyboard: [] } };
  return {
    async send(topicId, text, buttons) {
      const result = await call("sendMessage", { message_thread_id: topicId, text: clipForumText(text), ...markup(buttons) });
      const id = result.message_id;
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) throw new ForumBotError("Telegram не вернул номер сообщения");
      return id;
    },
    async edit(messageId, text, buttons) {
      try { await call("editMessageText", { message_id: messageId, text: clipForumText(text), ...markup(buttons) }); }
      catch (error) {
        // Nothing to change is success for an idempotent sync.
        if (error instanceof ForumBotError && /message is not modified/iu.test(error.detail)) return;
        throw error;
      }
    },
  };
}

export async function readGuardianSettings() { const { pool } = await import("./db"); return readGuardianSettingsWithDatabase(pool); }
export async function saveGuardianForumSettings(actorId: string, input: GuardianForumSettingsInput) {
  const { pool } = await import("./db"); return saveGuardianForumSettingsWithDatabase(pool, actorId, input);
}
// Production wiring: the Guardian bot token and the forum chat from the environment.
export async function productionForumBot(): Promise<{ bot: ForumBot; forumChatId: string } | null> {
  const { telegramBotToken, telegramReceptionConfig } = await import("./config");
  const token = telegramBotToken(), forumChatId = telegramReceptionConfig().forumChatId;
  return token && forumChatId && forumInternalId(forumChatId) ? { bot: telegramForumBot(token, forumChatId), forumChatId } : null;
}
