import {
  coreButtonUrl, discussionTopicKey, featureEnabled, forumMessageLink, topicFor,
  type ForumBot, type ForumButton, type GuardianSettings,
} from "./guardian-forum";
import type { InterfaceTextValues } from "./interface-texts";
import { signalHref, signalTypePresentation } from "./signal-presentation";
import { getSignalWithDatabase, type SignalDatabase, type SignalReader, type SignalType, type SignalVisibility } from "./signals";

// «Обсудить в Telegram»: Core keeps the record, the forum keeps the conversation.
// One Guardian message per record; the card button leads to it.
export type DiscussionDeps = {
  database: SignalDatabase; bot: ForumBot; forumChatId: string; settings: GuardianSettings;
  texts: InterfaceTextValues; baseUrl: string;
};
export type DiscussionResult =
  | { status: "open"; link: string; created: boolean; authorId: string | null }
  | { status: "pending" } | { status: "unavailable" };

// Named, open records only: an anonymous author would reveal themselves by answering,
// and «Ближе» never leaves Core.
export function discussionEligible(signal: { typeKey: string; visibility: SignalVisibility; status: string }): boolean {
  return signal.status === "active" && signal.typeKey !== "dating"
    && (signal.visibility === "public" || signal.visibility === "members");
}
export function discussionTopic(settings: GuardianSettings, typeKey: string): number | null {
  return featureEnabled(settings, "exchange_discussion") ? topicFor(settings, discussionTopicKey(typeKey)) : null;
}

type Content = { id: string; typeKey: string; label: string; description: string | null; authorName: string };
function message(content: Content, types: SignalType[], deps: Pick<DiscussionDeps, "settings" | "texts" | "baseUrl">): { text: string; buttons: ForumButton[] } {
  const type = types.find((entry) => entry.key === content.typeKey);
  const typeName = type ? signalTypePresentation(type, deps.texts).navigationName : content.typeKey;
  const card = signalHref(content.id);
  return {
    text: [`${typeName} · ${content.authorName}`, "", content.label,
      ...(content.description ? ["", content.description.length > 1500 ? content.description.slice(0, 1500) + "…" : content.description] : [])].join("\n"),
    buttons: [
      { text: deps.texts["forum.discussion_open"], url: coreButtonUrl(card, deps.settings, deps.baseUrl) },
      { text: deps.texts["forum.discussion_add"], url: coreButtonUrl(`/exchange/new?type=${content.typeKey}`, deps.settings, deps.baseUrl) },
    ],
  };
}

async function types(database: SignalReader): Promise<SignalType[]> {
  const result = await database.query("SELECT key, display_name, enabled FROM signal_types");
  return result.rows.map((row) => ({ key: String(row.key), displayName: String(row.display_name), enabled: Boolean(row.enabled) }));
}

export async function readDiscussionLinkWithDatabase(database: SignalReader, signalId: string, forumChatId: string | undefined): Promise<string | null> {
  const result = await database.query(
    "SELECT topic_id, message_id FROM signal_discussions WHERE signal_id = $1::uuid AND message_id IS NOT NULL AND NOT withdrawn", [signalId]);
  return result.rowCount ? forumMessageLink(forumChatId, Number(result.rows[0].topic_id), Number(result.rows[0].message_id)) : null;
}

// Any participant who can open the record may start its discussion. The row is claimed before
// Telegram is called, so two simultaneous clicks cannot publish two messages; a claim that never
// received its message (a crash in between) can be taken over after a minute.
export async function openDiscussion(deps: DiscussionDeps, viewerId: string, signalId: unknown): Promise<DiscussionResult> {
  const signal = await getSignalWithDatabase(deps.database, viewerId, signalId);
  if (!signal || !discussionEligible(signal) || !signal.author) return { status: "unavailable" };
  const topic = discussionTopic(deps.settings, signal.typeKey);
  if (!topic) return { status: "unavailable" };
  const existing = await readDiscussionLinkWithDatabase(deps.database, signal.id, deps.forumChatId);
  if (existing) return { status: "open", link: existing, created: false, authorId: null };
  const claim = await deps.database.query(
    `INSERT INTO signal_discussions AS d(signal_id, topic_id, opened_by) VALUES ($1::uuid, $2, $3::uuid)
     ON CONFLICT (signal_id) DO UPDATE SET topic_id = EXCLUDED.topic_id, opened_by = EXCLUDED.opened_by, updated_at = now()
       WHERE d.message_id IS NULL AND d.updated_at < now() - interval '60 seconds'
     RETURNING signal_id`, [signal.id, topic, viewerId]);
  if (!claim.rowCount) return { status: "pending" };
  let messageId: number;
  try {
    const { text, buttons } = message({ ...signal, authorName: signal.author.name }, await types(deps.database), deps);
    messageId = await deps.bot.send(topic, text, buttons);
  } catch (error) {
    await deps.database.query("DELETE FROM signal_discussions WHERE signal_id = $1::uuid AND message_id IS NULL", [signal.id]);
    throw error;
  }
  await deps.database.query(
    "UPDATE signal_discussions SET message_id = $2, withdrawn = false, updated_at = now() WHERE signal_id = $1::uuid", [signal.id, messageId]);
  // Reference only: the shared audit log never receives the record's text.
  await deps.database.query(`INSERT INTO events(event_type, participant_id, payload) VALUES ('signal.discussion_opened', $1::uuid, $2::jsonb)`,
    [viewerId, JSON.stringify({ signal_id: signal.id, topic_id: topic })]);
  return { status: "open", link: forumMessageLink(deps.forumChatId, topic, messageId)!, created: true,
    authorId: signal.mine ? null : signal.author.id };
}

// Keeps the forum message true to the record: an edited record updates it; a record that was
// archived or closed to the DAO is replaced by a short notice, so its text does not outlive it there.
export async function syncDiscussion(deps: Omit<DiscussionDeps, "forumChatId">, signalId: string): Promise<"none" | "updated" | "withdrawn"> {
  const result = await deps.database.query(
    `SELECT d.message_id, d.withdrawn, s.id, s.kind, s.label, s.description, s.visibility, s.status, author.display_name
       FROM signal_discussions d JOIN profile_signals s ON s.id = d.signal_id
       JOIN participants author ON author.id = s.participant_id
      WHERE d.signal_id = $1::uuid AND d.message_id IS NOT NULL`, [signalId]);
  if (!result.rowCount) return "none";
  const row = result.rows[0];
  const eligible = discussionEligible({ typeKey: String(row.kind), visibility: String(row.visibility) as SignalVisibility, status: String(row.status) });
  if (!eligible && row.withdrawn) return "withdrawn";
  if (eligible) {
    const { text, buttons } = message({ id: String(row.id), typeKey: String(row.kind), label: String(row.label),
      description: row.description == null ? null : String(row.description), authorName: String(row.display_name) }, await types(deps.database), deps);
    await deps.bot.edit(Number(row.message_id), text, buttons);
  } else {
    await deps.bot.edit(Number(row.message_id), deps.texts["forum.discussion_withdrawn"], []);
  }
  await deps.database.query("UPDATE signal_discussions SET withdrawn = $2, updated_at = now() WHERE signal_id = $1::uuid", [signalId, !eligible]);
  return eligible ? "updated" : "withdrawn";
}
