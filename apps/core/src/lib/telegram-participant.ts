import { linkTelegramRosterEntryWithClient } from "./telegram-roster";

type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
export type TelegramParticipantClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};

export class TelegramParticipantIdentityConflictError extends Error {
  constructor() {
    super("Telegram user ID resolves to conflicting Participant identities");
    this.name = "TelegramParticipantIdentityConflictError";
  }
}

async function resolveTelegramParticipantById(
  client: TelegramParticipantClient,
  telegramUserId: string,
  lock: boolean,
): Promise<{ participantId: string | null; identity: Record<string, unknown> | null }> {
  if (!/^[1-9]\d*$/.test(telegramUserId) ||
      !Number.isSafeInteger(Number(telegramUserId))) {
    throw new Error("Invalid Telegram user ID");
  }

  const roster = await client.query(
    `SELECT participant_id FROM telegram_roster_entries
      WHERE telegram_user_id = $1::bigint${lock ? " FOR UPDATE" : ""}`,
    [telegramUserId],
  );
  const rosterParticipantId = roster.rowCount && roster.rows[0].participant_id
    ? String(roster.rows[0].participant_id) : null;
  const identity = await client.query(
    `SELECT id, participant_id, provider_subject, external_user_id
       FROM external_identities
      WHERE provider = 'telegram'
        AND (external_user_id = $1 OR provider_subject = $2
          OR ($3::uuid IS NOT NULL AND participant_id = $3::uuid))
      ${lock ? "FOR UPDATE" : ""}`,
    [telegramUserId, `roster:${telegramUserId}`, rosterParticipantId],
  );
  const identities = identity.rows;
  const participantIds = new Set(identities.map((row) => String(row.participant_id)));
  if (rosterParticipantId) participantIds.add(rosterParticipantId);
  if (participantIds.size > 1 || identities.length > 1 ||
      identities.some((row) => row.external_user_id !== null &&
        row.external_user_id !== undefined && String(row.external_user_id) !== telegramUserId) ||
      identities.some((row) => typeof row.provider_subject === "string" &&
        row.provider_subject.startsWith("roster:") &&
        row.provider_subject !== `roster:${telegramUserId}`)) {
    throw new TelegramParticipantIdentityConflictError();
  }

  return {
    participantId: participantIds.values().next().value as string | undefined ?? null,
    identity: identities[0] ?? null,
  };
}

// Read-only classification for a one-shot import preview. The apply path repeats
// resolution under locks, so a concurrent identity change cannot be merged.
export async function inspectTelegramParticipantById(
  client: TelegramParticipantClient,
  telegramUserId: string,
): Promise<string | null> {
  return (await resolveTelegramParticipantById(client, telegramUserId, false)).participantId;
}

// Call inside the caller's transaction so identity creation and forum observation
// either both commit or both roll back.
export async function findOrCreateParticipantByTelegramIdWithResult(
  client: TelegramParticipantClient,
  telegramUserId: string,
  source: "telegram_forum_join" | "mtproto_roster" = "telegram_forum_join",
): Promise<{ participantId: string; created: boolean }> {
  // Serialize competing join updates before checking for an existing identity.
  await client.query("SELECT pg_advisory_xact_lock(42006, hashtext($1::text))", [telegramUserId]);
  const resolved = await resolveTelegramParticipantById(client, telegramUserId, true);
  let participantId = resolved.participantId ?? undefined;
  const created = !participantId;
  if (!participantId) {
    const participant = await client.query(
      `INSERT INTO participants(display_name, membership_status)
       VALUES ('Участник форума', 'none') RETURNING id`,
    );
    participantId = String(participant.rows[0].id);
  }

  try {
    if (resolved.identity && !resolved.identity.external_user_id) {
      await client.query(
        `UPDATE external_identities SET external_user_id = $2, updated_at = now()
          WHERE id = $1`,
        [resolved.identity.id, telegramUserId],
      );
    } else if (!resolved.identity) {
      await client.query(
        `INSERT INTO external_identities(
           participant_id, provider, provider_subject, external_user_id)
         VALUES ($1, 'telegram', $2, $3)`,
        [participantId, `roster:${telegramUserId}`, telegramUserId],
      );
    }
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new TelegramParticipantIdentityConflictError();
    }
    throw error;
  }

  await linkTelegramRosterEntryWithClient(client, telegramUserId, participantId);
  if (created) {
    await client.query(
      `INSERT INTO events(event_type, participant_id, payload)
       VALUES ('participant.created', $1, $2::jsonb)`,
      [participantId, JSON.stringify({ source })],
    );
  }
  return { participantId, created };
}

export async function findOrCreateParticipantByTelegramId(
  client: TelegramParticipantClient,
  telegramUserId: string,
): Promise<string> {
  return (await findOrCreateParticipantByTelegramIdWithResult(client, telegramUserId))
    .participantId;
}
