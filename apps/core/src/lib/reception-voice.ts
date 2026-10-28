import { coreButtonUrl, featureEnabled, type ForumButton, type GuardianSettings } from "./guardian-forum";
import type { InterfaceTextValues } from "./interface-texts";
import type { SignalReader } from "./signals";

// What the reception bot says to a person on the way in. The relay itself only moves
// messages; without these three lines an applicant talks into silence.
export type ReceptionButton = ForumButton | { text: string; web_app: { url: string } };
export type ReceptionSender = (telegramUserId: string, text: string, button?: ReceptionButton) => Promise<void>;
type Base = { settings: GuardianSettings; texts: InterfaceTextValues; send: ReceptionSender };

// "Запустить": invite a stranger to introduce themselves. A current forum member is not asked again.
export async function greetOnStart(deps: Base & { isMember: () => Promise<boolean>; applyButton?: ReceptionButton }, telegramUserId: string): Promise<boolean> {
  if (!featureEnabled(deps.settings, "reception_greeting")) return false;
  if (await deps.isMember().catch(() => false)) return false;
  if (deps.applyButton) await deps.send(telegramUserId, deps.texts["reception.greeting"], deps.applyButton);
  else await deps.send(telegramUserId, deps.texts["reception.greeting"]);
  return true;
}

export function receptionApplicationButton(baseUrl: string, enabled: boolean, text: string): ReceptionButton | undefined {
  if (!enabled) return undefined;
  try {
    const url = new URL("/reception/apply", baseUrl);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return { text, web_app: { url: url.toString() } };
  } catch { return undefined; }
}

// After an introduction was relayed: one acknowledgement, not one per message of a long story.
export async function acknowledgeIntroduction(deps: Base & { database: SignalReader }, privateChatId: string): Promise<boolean> {
  if (!featureEnabled(deps.settings, "reception_greeting")) return false;
  const recent = await deps.database.query(
    `SELECT count(*)::integer AS count FROM reception_relay_updates
      WHERE private_chat_id = $1 AND direction = 'private_to_forum' AND status = 'sent'
        AND created_at > now() - interval '12 hours'`, [privateChatId]);
  if (Number(recent.rows[0]?.count ?? 0) !== 1) return false;
  await deps.send(privateChatId, deps.texts["reception.received"]);
  return true;
}

// Accepted into the forum: welcome once and open the way to the profile. The row is claimed
// before sending, so repeated membership updates cannot welcome twice.
export async function welcomeAfterJoining(deps: Base & { database: SignalReader; baseUrl: string }, telegramUserId: string): Promise<boolean> {
  if (!featureEnabled(deps.settings, "reception_welcome")) return false;
  const claim = await deps.database.query(
    `INSERT INTO reception_messages(telegram_user_id, kind) VALUES ($1, 'welcome') ON CONFLICT DO NOTHING RETURNING kind`, [telegramUserId]);
  if (!claim.rowCount) return false;
  try {
    await deps.send(telegramUserId, deps.texts["reception.welcome"],
      { text: deps.texts["reception.welcome_button"], url: coreButtonUrl("/profile", deps.settings, deps.baseUrl) });
  } catch (error) {
    // Not delivered (most often the person never started this bot): leave no trace, a later join may try again.
    await deps.database.query("DELETE FROM reception_messages WHERE telegram_user_id = $1 AND kind = 'welcome'", [telegramUserId]);
    throw error;
  }
  return true;
}

// Whether a forum membership update is a person coming in (not leaving, not a bot).
export function joinedUserId(update: unknown): string | null {
  const change = (update as { chat_member?: Record<string, unknown> } | null)?.chat_member;
  const present = (member: unknown) => {
    const m = member as { status?: unknown; is_member?: unknown } | undefined;
    return m?.status === "creator" || m?.status === "administrator" || m?.status === "member" || (m?.status === "restricted" && m.is_member === true);
  };
  const user = (change?.new_chat_member as { user?: { id?: unknown; is_bot?: unknown } } | undefined)?.user;
  if (!change || !user || user.is_bot === true || typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  return present(change.new_chat_member) && !present(change.old_chat_member) ? String(user.id) : null;
}

// Production wiring. Every entry point is best-effort: the bot's voice must never break the relay.
async function production() {
  const [{ telegramReceptionConfig, appBaseUrl }, { readGuardianSettings }, { readInterfaceTexts }, { pool }] = await Promise.all([
    import("./config"), import("./guardian-forum"), import("./interface-texts"), import("./db")]);
  const { token, forumChatId, miniAppEnabled } = telegramReceptionConfig();
  if (!token) return null;
  const send: ReceptionSender = async (telegramUserId, text, button) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ chat_id: Number(telegramUserId), text, link_preview_options: { is_disabled: true },
        ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}) }),
    });
    const data = await response.json().catch(() => null) as { ok?: boolean; description?: string } | null;
    if (!data?.ok) throw new Error(`Reception bot message was not delivered: ${data?.description ?? response.status}`);
  };
  return { token, forumChatId, miniAppEnabled, send, database: pool, baseUrl: appBaseUrl(),
    settings: await readGuardianSettings(), texts: (await readInterfaceTexts()).values };
}

export async function onReceptionStart(telegramUserId: string): Promise<void> {
  try {
    const context = await production();
    if (!context) return;
    const { receptionBot } = await import("./telegram-forum-onboarding");
    const applyButton = receptionApplicationButton(context.baseUrl, context.miniAppEnabled, context.texts["reception.apply.button"]);
    const greeted = await greetOnStart({ ...context, applyButton, isMember: () => context.forumChatId
      ? receptionBot(context.token).getMember(context.forumChatId, telegramUserId) : Promise.resolve(false) }, telegramUserId);
    if (!greeted && applyButton) await context.send(telegramUserId, context.texts["reception.apply.start"], applyButton);
  } catch { console.error("Reception greeting failed"); }
}
export async function onReceptionRelayed(privateChatId: string, text: string | null = null, updateId: number | null = null): Promise<void> {
  try {
    const context = await production();
    if (context) {
      try { await acknowledgeIntroduction(context, privateChatId); }
      catch { console.error("Reception acknowledgement failed"); }
      if (text && updateId !== null) {
        const [{ createReceptionProfileDraft }, { pool }] = await Promise.all([
          import("./reception-profile-draft"), import("./db"),
        ]);
        await createReceptionProfileDraft(privateChatId, text, updateId, pool);
      }
    }
  } catch (error) { console.error("Reception acknowledgement failed", error); }
}
export async function onForumMemberUpdate(update: unknown): Promise<void> {
  try {
    const telegramUserId = joinedUserId(update);
    if (!telegramUserId) return;
    const context = await production();
    if (context) await welcomeAfterJoining(context, telegramUserId);
  } catch (error) { console.error("Reception welcome failed", error); }
}
