import { coreButtonUrl, topicFor, type ForumBot, type GuardianSettings } from "./guardian-forum";
import type { InterfaceTextValues } from "./interface-texts";
import type { ProposalDatabaseClient } from "./proposals";
// An announcement contains only the question and link. No ballot data is queried.
export async function announcePoll(context: {
  database: Pick<ProposalDatabaseClient, "query">; bot: ForumBot; settings: GuardianSettings; texts: InterfaceTextValues; baseUrl: string;
}, id: string): Promise<void> {
  const topic = topicFor(context.settings, "topic.veche");
  if (!topic) return;
  const row = (await context.database.query(`UPDATE proposals SET poll_announcement_claimed_at=clock_timestamp()
    WHERE id=$1 AND poll_circle IS NOT NULL AND poll_announcement_claimed_at IS NULL RETURNING title`, [id])).rows[0];
  if (!row) return;
  // Claim precedes send: an uncertain Telegram outcome is not retried automatically.
  const message = await context.bot.send(topic, `${context.texts["veche.announcement"]}\n${String(row.title)}`,
    [{ text: context.texts["veche.announcement_button"], url: coreButtonUrl(`/veche/${id}`, context.settings, context.baseUrl) }]);
  await context.database.query("UPDATE proposals SET poll_announcement_message_id=$2 WHERE id=$1", [id, message]);
}
export async function afterPollCalled(id: string) {
  try { const context = await (await import("./guardian-forum-actions")).forumDeps(); if (context) await announcePoll(context, id); }
  catch { console.error("Veche announcement failed"); }
}
