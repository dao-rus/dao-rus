import {
  findOrCreateParticipantByTelegramIdWithResult,
  inspectTelegramParticipantById,
  TelegramParticipantIdentityConflictError,
  type TelegramParticipantClient,
} from "./telegram-participant";
import {
  parseTelegramRosterSnapshot,
  upsertTelegramRosterSnapshotWithClient,
  type TelegramRosterDatabase,
  type TelegramRosterSnapshot,
} from "./telegram-roster";

export type ForumRosterPreview = {
  accountsFound: number;
  botsSkipped: number;
  peopleFound: number;
  existingParticipants: number;
  newParticipants: number;
  conflicts: number;
  observedAt: string;
};

export type ForumRosterApplyResult = ForumRosterPreview & {
  participantsCreated: number;
  forumJoinedRecorded: number;
};

function forumSnapshot(value: unknown, forumChatId: string): TelegramRosterSnapshot {
  if (!/^-100[1-9]\d*$/.test(forumChatId)) {
    throw new Error("TELEGRAM_FORUM_CHAT_ID must be a forum supergroup ID");
  }
  const metadata = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).chat : null;
  const chat = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown> : null;
  const chatId = chat?.id;
  if (typeof chatId !== "string" && typeof chatId !== "number") {
    throw new Error("Snapshot is missing the Telegram forum chat ID");
  }
  const canonicalChatId = String(chatId).startsWith("-100")
    ? String(chatId) : `-100${String(chatId)}`;
  if (canonicalChatId !== forumChatId) {
    throw new Error("Snapshot belongs to a different Telegram forum");
  }
  return parseTelegramRosterSnapshot(value);
}

export async function previewTelegramForumRosterImport(
  database: TelegramRosterDatabase,
  snapshotValue: unknown,
  forumChatId: string,
): Promise<ForumRosterPreview> {
  const snapshot = forumSnapshot(snapshotValue, forumChatId);
  const people = snapshot.entries.filter((entry) => !entry.isBot);
  const preview: ForumRosterPreview = {
    accountsFound: snapshot.entries.length,
    botsSkipped: snapshot.entries.length - people.length,
    peopleFound: people.length,
    existingParticipants: 0,
    newParticipants: 0,
    conflicts: 0,
    observedAt: snapshot.observedAt,
  };
  const client = await database.connect();
  const participantCounts = new Map<string, number>();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    for (const entry of people) {
      try {
        const participantId = await inspectTelegramParticipantById(
          client, entry.telegramUserId,
        );
        if (participantId) {
          participantCounts.set(participantId, (participantCounts.get(participantId) ?? 0) + 1);
          preview.existingParticipants++;
        } else preview.newParticipants++;
      } catch (error) {
        if (!(error instanceof TelegramParticipantIdentityConflictError)) throw error;
        preview.conflicts++;
      }
    }
    for (const count of participantCounts.values()) {
      if (count > 1) {
        preview.existingParticipants -= count;
        preview.conflicts += count;
      }
    }
    await client.query("COMMIT");
    return preview;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Keep the original error. */ }
    throw error;
  } finally {
    client.release();
  }
}

async function recordForumJoinedFromRoster(
  client: TelegramParticipantClient,
  participantId: string,
  observedAt: string,
): Promise<boolean> {
  const timestamp = new Date(observedAt);
  const inserted = await client.query(
    `INSERT INTO participant_forum_onboarding(participant_id, forum_status, observed_at)
     VALUES ($1, 'joined', $2) ON CONFLICT (participant_id) DO NOTHING`,
    [participantId, timestamp],
  );
  const current = await client.query(
    `SELECT forum_status, observed_at FROM participant_forum_onboarding
      WHERE participant_id = $1 FOR UPDATE`,
    [participantId],
  );
  const row = current.rows[0];
  const wasJoined = row.forum_status === "joined";
  const fresh = new Date(String(row.observed_at)).getTime() <= timestamp.getTime();
  if (fresh) {
    await client.query(
      `UPDATE participant_forum_onboarding
          SET forum_status = 'joined', observed_at = $2
        WHERE participant_id = $1`,
      [participantId, timestamp],
    );
  }
  if (!inserted.rowCount && (!fresh || wasJoined)) return false;
  await client.query(
    `INSERT INTO events(event_type, participant_id, payload)
     VALUES ('onboarding.forum_joined', $1, $2::jsonb)`,
    [participantId, JSON.stringify({ source: "mtproto_roster", observed_at: observedAt })],
  );
  return true;
}

export async function applyTelegramForumRosterImport(
  database: TelegramRosterDatabase,
  snapshotValue: unknown,
  forumChatId: string,
  now = new Date(),
): Promise<ForumRosterApplyResult> {
  const snapshot = forumSnapshot(snapshotValue, forumChatId);
  const snapshotAge = now.getTime() - new Date(snapshot.observedAt).getTime();
  if (snapshotAge < -5 * 60_000 || snapshotAge > 24 * 60 * 60_000) {
    throw new Error("Apply requires a forum roster snapshot from the last 24 hours");
  }
  const preview = await previewTelegramForumRosterImport(database, snapshotValue, forumChatId);
  if (!preview.peopleFound) throw new Error("Cannot apply an empty human forum roster");
  if (preview.conflicts) throw new Error("Forum roster has identity conflicts; apply cancelled");

  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(42007, hashtext($1::text))", [forumChatId]);
    const peopleSnapshot = {
      ...snapshot,
      entries: snapshot.entries.filter((entry) => !entry.isBot),
    };
    await upsertTelegramRosterSnapshotWithClient(client, peopleSnapshot);
    let participantsCreated = 0;
    let forumJoinedRecorded = 0;
    for (const entry of peopleSnapshot.entries) {
      const resolved = await findOrCreateParticipantByTelegramIdWithResult(
        client, entry.telegramUserId, "mtproto_roster",
      );
      if (resolved.created) participantsCreated++;
      if (await recordForumJoinedFromRoster(
        client, resolved.participantId, snapshot.observedAt,
      )) forumJoinedRecorded++;
    }
    await client.query("COMMIT");
    return { ...preview, participantsCreated, forumJoinedRecorded };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Keep the original error. */ }
    throw error;
  } finally {
    client.release();
  }
}
