import { coreButtonUrl, featureEnabled, topicFor, type ForumBot, type GuardianSettings } from "./guardian-forum";
import type { InterfaceTextValues } from "./interface-texts";
import type { SignalDatabase, SignalReader } from "./signals";

// Guardian introduces a newcomer in the forum once they have told Core a city or an interest.
// Only what other participants already see in the profile is announced, only for people who
// joined after the feature appeared, and never against the person's own switch.
export type NewcomerDeps = { database: SignalDatabase; bot: ForumBot; settings: GuardianSettings; texts: InterfaceTextValues; baseUrl: string };

export async function isNewcomerWithDatabase(database: SignalReader, participantId: string): Promise<boolean> {
  const result = await database.query(
    `SELECT 1 FROM participants p, guardian_settings since
      WHERE p.id = $1::uuid AND since.key = 'newcomers.since' AND p.created_at >= since.updated_at`, [participantId]);
  return Boolean(result.rowCount);
}

export async function setForumAnnouncementWithDatabase(database: SignalReader, participantId: string, announce: boolean): Promise<void> {
  await database.query("UPDATE participants SET announce_in_forum = $2 WHERE id = $1::uuid AND announce_in_forum IS DISTINCT FROM $2", [participantId, announce]);
}

export async function syncNewcomerAnnouncement(deps: NewcomerDeps, participantId: string): Promise<"none" | "announced" | "updated" | "hidden"> {
  const topic = featureEnabled(deps.settings, "newcomer_announcements") ? topicFor(deps.settings, "topic.newcomers") : null;
  const person = await deps.database.query(
    `SELECT p.display_name, p.residence_name, p.announce_in_forum, (p.membership_status = 'participant') AS member,
            (SELECT p.created_at >= since.updated_at FROM guardian_settings since WHERE since.key = 'newcomers.since') AS newcomer,
            ARRAY(SELECT i.label FROM participant_interests i WHERE i.participant_id = p.id
                    AND i.visibility IN ('public', 'members') ORDER BY i.created_at, i.label LIMIT 12) AS interests,
            a.message_id, a.hidden, (a.participant_id IS NOT NULL) AS claimed
       FROM participants p LEFT JOIN newcomer_announcements a ON a.participant_id = p.id
      WHERE p.id = $1::uuid`, [participantId]);
  if (!person.rowCount) return "none";
  const row = person.rows[0];
  const interests = (row.interests as string[]) ?? [];
  const messageId = row.message_id == null ? null : Number(row.message_id);
  const wanted = Boolean(row.announce_in_forum) && (row.residence_name != null || interests.length > 0);

  // A message already in the forum follows the person's current choice, whatever the switches say now.
  if (messageId && !wanted) {
    if (row.hidden) return "hidden";
    await deps.bot.edit(messageId, deps.texts["forum.newcomer_hidden"], []);
    await deps.database.query("UPDATE newcomer_announcements SET hidden = true, updated_at = now() WHERE participant_id = $1::uuid", [participantId]);
    return "hidden";
  }
  // Signing in to Core is open to applicants too; only an accepted member of the forum is introduced there.
  if (!wanted || (!messageId && (!topic || !row.newcomer || !row.member))) return "none";
  const text = [`${deps.texts["forum.newcomer_title"]}: ${String(row.display_name)}`,
    ...(row.residence_name != null ? [`${deps.texts["forum.newcomer_city"]}: ${String(row.residence_name)}`] : []),
    ...(interests.length ? [`${deps.texts["forum.newcomer_interests"]}: ${interests.join(", ")}`] : [])].join("\n");
  const buttons = [
    { text: deps.texts["forum.newcomer_profile"], url: coreButtonUrl(`/profile/${participantId}`, deps.settings, deps.baseUrl) },
    { text: deps.texts["forum.newcomer_nearby"], url: coreButtonUrl("/nearby", deps.settings, deps.baseUrl) },
  ];
  if (messageId) {
    await deps.bot.edit(messageId, text, buttons);
    await deps.database.query("UPDATE newcomer_announcements SET hidden = false, updated_at = now() WHERE participant_id = $1::uuid", [participantId]);
    return "updated";
  }
  // Claim first, so two quick profile saves cannot announce the same person twice.
  const claim = await deps.database.query(
    `INSERT INTO newcomer_announcements AS a(participant_id, topic_id) VALUES ($1::uuid, $2)
     ON CONFLICT (participant_id) DO UPDATE SET topic_id = EXCLUDED.topic_id, updated_at = now()
       WHERE a.message_id IS NULL AND a.updated_at < now() - interval '60 seconds'
     RETURNING participant_id`, [participantId, topic]);
  if (!claim.rowCount) return "none";
  try {
    const sent = await deps.bot.send(topic!, text, buttons);
    await deps.database.query("UPDATE newcomer_announcements SET message_id = $2, updated_at = now() WHERE participant_id = $1::uuid", [participantId, sent]);
  } catch (error) {
    await deps.database.query("DELETE FROM newcomer_announcements WHERE participant_id = $1::uuid AND message_id IS NULL", [participantId]);
    throw error;
  }
  return "announced";
}

// Whether the profile shows the "announce me" checkbox, and its current value. Only newcomers see it,
// and only while announcements can actually happen.
export async function readForumAnnouncementChoice(participantId: string): Promise<{ announce: boolean } | null> {
  const [{ pool }, { readGuardianSettings }] = await Promise.all([import("./db"), import("./guardian-forum")]);
  const settings = await readGuardianSettings();
  if (!featureEnabled(settings, "newcomer_announcements") || !topicFor(settings, "topic.newcomers")) return null;
  if (!await isNewcomerWithDatabase(pool, participantId)) return null;
  const result = await pool.query("SELECT announce_in_forum FROM participants WHERE id = $1::uuid", [participantId]);
  return result.rowCount ? { announce: Boolean(result.rows[0].announce_in_forum) } : null;
}
