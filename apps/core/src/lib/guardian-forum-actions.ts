import { productionForumBot, readGuardianSettings } from "./guardian-forum";
import { readInterfaceTexts } from "./interface-texts";

// Adapters call these after the user's own action has been saved. Forum side effects are
// best-effort: Telegram being unavailable must never fail saving a profile or a record.
async function deps() {
  const forum = await productionForumBot();
  if (!forum) return null;
  const [{ pool }, { appBaseUrl }, settings, { values: texts }] = await Promise.all([
    import("./db"), import("./config"), readGuardianSettings(), readInterfaceTexts()]);
  const receptionTopicId = Number((await import("./config")).telegramReceptionConfig().topicId);
  return { database: pool, bot: forum.bot, forumChatId: forum.forumChatId, settings, texts, baseUrl: appBaseUrl(),
    receptionTopicId: Number.isSafeInteger(receptionTopicId) && receptionTopicId > 0 ? receptionTopicId : undefined };
}
export async function forumDeps() { return deps(); }

export async function afterSignalChanged(signalId: string): Promise<void> {
  try {
    const context = await deps();
    if (context) await (await import("./signal-discussion")).syncDiscussion(context, signalId);
  } catch (error) { console.error("Forum discussion sync failed", error); }
}
export async function afterProfileChanged(participantId: string): Promise<void> {
  try {
    const context = await deps();
    if (context) await (await import("./newcomer-announcement")).syncNewcomerAnnouncement(context, participantId);
  } catch (error) { console.error("Newcomer announcement failed", error); }
}

// A person accepted into the forum may have filled in the profile earlier, while still an applicant.
export async function afterForumMemberUpdate(update: unknown): Promise<void> {
  try {
    const user = (update as { chat_member?: { new_chat_member?: { user?: { id?: unknown } } } })?.chat_member?.new_chat_member?.user?.id;
    if (typeof user !== "number" || !Number.isSafeInteger(user)) return;
    const { pool } = await import("./db");
    const found = await pool.query(
      "SELECT participant_id FROM external_identities WHERE provider = 'telegram' AND external_user_id = $1 LIMIT 1", [String(user)]);
    if (found.rowCount) await afterProfileChanged(String(found.rows[0].participant_id));
  } catch (error) { console.error("Newcomer announcement after joining failed", error); }
}
