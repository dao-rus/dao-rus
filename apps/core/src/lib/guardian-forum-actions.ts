import { productionForumBot, readGuardianSettings } from "./guardian-forum";
import { readInterfaceTexts } from "./interface-texts";

// Adapters call these after the user's own action has been saved. Forum side effects are
// best-effort: Telegram being unavailable must never fail saving a profile or a record.
async function deps() {
  const forum = await productionForumBot();
  if (!forum) return null;
  const [{ pool }, { appBaseUrl }, settings, { values: texts }] = await Promise.all([
    import("./db"), import("./config"), readGuardianSettings(), readInterfaceTexts()]);
  return { database: pool, bot: forum.bot, forumChatId: forum.forumChatId, settings, texts, baseUrl: appBaseUrl() };
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
