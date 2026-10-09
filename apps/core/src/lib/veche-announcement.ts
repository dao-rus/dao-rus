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
    WHERE id=$1 AND poll_circle IS NOT NULL AND (poll_call_state IS NULL OR poll_call_state='called') AND poll_announcement_claimed_at IS NULL RETURNING title`, [id])).rows[0];
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

export async function announceSignatureCollection(context: Parameters<typeof announcePoll>[0], id:string) {
  const topic=topicFor(context.settings,"topic.veche");if(!topic)return;
  const row=(await context.database.query(`UPDATE proposals SET poll_collection_announcement_claimed_at=clock_timestamp()
    WHERE id=$1 AND poll_call_state='collecting' AND poll_collection_announcement_claimed_at IS NULL RETURNING title`,[id])).rows[0];
  if(!row)return;
  const message=await context.bot.send(topic,`${context.texts["veche.signature_announcement"]}\n${String(row.title)}\n${context.texts["veche.signature_meaning"]}`,
    [{text:context.texts["veche.signature_support"],url:coreButtonUrl(`/veche/${id}`,context.settings,context.baseUrl)}]);
  await context.database.query("UPDATE proposals SET poll_collection_announcement_message_id=$2 WHERE id=$1",[id,message]);
}
export async function afterSignatureCallChanged(id:string) {
  try {
    const context=await(await import("./guardian-forum-actions")).forumDeps();if(!context)return;
    const state=(await context.database.query("SELECT poll_call_state FROM proposals WHERE id=$1",[id])).rows[0]?.poll_call_state;
    if(state==="collecting")await announceSignatureCollection(context,id);
    else if(state==="called")await announcePoll(context,id);
  }catch{console.error("Veche signature announcement failed");}
}
export async function flushVecheAnnouncements() {
  try {
    const context=await(await import("./guardian-forum-actions")).forumDeps();if(!context||!topicFor(context.settings,"topic.veche"))return;
    const rows=(await context.database.query(`SELECT id,poll_call_state FROM proposals
      WHERE (poll_call_state='collecting' AND poll_collection_announcement_claimed_at IS NULL)
      OR (poll_call_state='called' AND poll_announcement_claimed_at IS NULL) ORDER BY created_at,id LIMIT 20`)).rows;
    for(const row of rows){
      try {if(row.poll_call_state==="collecting")await announceSignatureCollection(context,String(row.id));else await announcePoll(context,String(row.id));}
      catch{console.error("Veche announcement delivery failed");}
    }
  }catch{console.error("Veche announcement cycle failed");}
}
