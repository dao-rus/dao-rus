import { pool } from "./db";
import { telegramReceptionConfig } from "./config";
import { findOrCreateParticipantByTelegramId } from "./telegram-participant";
import { applyReceptionDraftWithClient } from "./reception-profile-apply";

type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
export type ForumDatabase = {
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<QueryResult>;
    release(destroy?: boolean): void;
  }>;
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

type BotResponse = { ok?: boolean; result?: unknown; error_code?: number };
export type ForumBot = {
  getMember(chatId: string, userId: string): Promise<boolean>;
  sendInvite(userId: string, url: string): Promise<"sent" | "blocked" | "unknown">;
};

function validTelegramId(value: string): boolean {
  return /^-?[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

function validUserId(value: string): boolean {
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

async function botRequest(token: string, method: string, params: object): Promise<BotResponse> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  return await response.json() as BotResponse;
}

export function receptionBot(token: string): ForumBot {
  return {
    async getMember(chatId, userId) {
      const response = await botRequest(token, "getChatMember", {
        chat_id: chatId, user_id: Number(userId),
      });
      if (!response.ok) throw new Error("Forum membership could not be checked");
      const member = record(response.result);
      if (!member || typeof member.status !== "string") {
        throw new Error("Invalid forum membership response");
      }
      if (["creator", "administrator", "member"].includes(member.status)) return true;
      if (member.status === "restricted") return member.is_member === true;
      if (member.status === "left" || member.status === "kicked") return false;
      throw new Error("Unknown forum membership status");
    },
    async sendInvite(userId, url) {
      try {
        const response = await botRequest(token, "sendMessage", {
          chat_id: Number(userId),
          text: `Рады видеть вас в DAO Core. В основном форуме ДАО Русь можно познакомиться с участниками и присоединиться к обсуждениям. Если вам это интересно, вход здесь: ${url}\n\nУчастие в форуме добровольно и не влияет на доступ к Core.`,
        });
        if (response.ok) return "sent";
        return response.error_code === 403 || response.error_code === 400 ? "blocked" : "unknown";
      } catch {
        return "unknown";
      }
    },
  };
}

type ForumObservation = { participantId: string; changed: boolean; shouldInvite: boolean } | null;

export async function observeForumMembership(
  database: ForumDatabase,
  userId: string,
  joined: boolean,
  observedAt: Date,
  inviteSource: "login" | "start" | null,
  source: "getChatMember" | "chat_member" = "getChatMember",
  updateId?: number,
  createMissingParticipant = false,
  transition?: { wasJoined: boolean; status: string },
): Promise<ForumObservation> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`reception-application:${userId}`]);
    let participantId: string;
    if (createMissingParticipant) {
      participantId = await findOrCreateParticipantByTelegramId(client, userId);
    } else {
      const identity = await client.query(
        `SELECT participant_id FROM external_identities
          WHERE provider = 'telegram' AND external_user_id = $1 LIMIT 1`,
        [userId],
      );
      if (!identity.rowCount) {
        await client.query("COMMIT");
        return null;
      }
      participantId = String(identity.rows[0].participant_id);
    }
    const inserted = await client.query(
      `INSERT INTO participant_forum_onboarding(participant_id, forum_status, observed_at)
       VALUES ($1, $2, $3) ON CONFLICT (participant_id) DO NOTHING`,
      [participantId, joined ? "joined" : "absent", observedAt],
    );
    const current = await client.query(
      `SELECT forum_status, observed_at, invitation_attempted_at, invitation_blocked_at
         FROM participant_forum_onboarding WHERE participant_id = $1 FOR UPDATE`,
      [participantId],
    );
    const row = current.rows[0];
    const previousStatus = String(row.forum_status);
    const fresh = new Date(String(row.observed_at)).getTime() <= observedAt.getTime();
    const status = fresh ? (joined ? "joined" : "absent") : previousStatus;
    const changed = fresh && previousStatus !== status;
    if (fresh) {
      await client.query(
        `UPDATE participant_forum_onboarding SET forum_status = $2, observed_at = $3
          WHERE participant_id = $1`,
        [participantId, status, observedAt],
      );
    }
    if (source === "chat_member" && transition && transition.wasJoined !== joined) {
      // The locked onboarding row serializes lifecycle history and duplicate checks.
      // Late updates still contribute history, without overwriting newer current state.
      const history = await client.query(
        `SELECT event_type, payload FROM events WHERE participant_id = $1
          AND event_type = ANY($2::text[])`,
        [participantId, ["forum.joined", "forum.rejoined", "forum.left", "forum.removed", "onboarding.forum_joined"]],
      );
      const alreadyObserved = history.rows.some((event) => {
        const payload = record(event.payload);
        return payload?.source === source && (updateId !== undefined
          ? payload.telegram_update_id === updateId
          : payload.observed_at === observedAt.toISOString());
      });
      const previouslyJoined = history.rows.some((event) =>
        ["forum.joined", "forum.rejoined", "forum.left", "forum.removed", "onboarding.forum_joined"].includes(String(event.event_type))
        && (!record(event.payload)?.observed_at || new Date(String(record(event.payload)?.observed_at)) <= observedAt));
      const lifecycle = joined ? (previouslyJoined ? "forum.rejoined" : "forum.joined")
        : transition.status === "left" ? "forum.left"
        : transition.status === "kicked" ? "forum.removed" : null;
      if (lifecycle && !alreadyObserved) {
        await client.query(`INSERT INTO events(event_type, participant_id, payload) VALUES ($1, $2, $3::jsonb)`,
          [lifecycle, participantId, JSON.stringify({ source, observed_at: observedAt.toISOString(),
            ...(updateId === undefined ? {} : { telegram_update_id: updateId }) })]);
      }
    }
    if (source !== "chat_member" && (changed || Boolean(inserted.rowCount))) {
      await client.query(
        `INSERT INTO events(event_type, participant_id, payload)
         VALUES ($1, $2, $3::jsonb)`,
        [status === "joined" ? "onboarding.forum_joined" : "onboarding.forum_incomplete",
          participantId, JSON.stringify({ source, observed_at: observedAt.toISOString(),
            ...(updateId === undefined ? {} : { telegram_update_id: updateId }) })],
      );
    }
    const shouldInvite = fresh && status === "absent" && inviteSource !== null &&
      (!row.invitation_attempted_at || (inviteSource === "start" && Boolean(row.invitation_blocked_at)));
    if (shouldInvite) {
      await client.query(
        `UPDATE participant_forum_onboarding
            SET invitation_attempted_at = now(), invitation_blocked_at = NULL
          WHERE participant_id = $1`,
        [participantId],
      );
    }
    if (status === "joined") {
      // Profile extraction must not prevent membership observation or welcome.
      // Backfill calls the strict function directly and rolls back on any conflict.
      await client.query("SAVEPOINT reception_profile_apply");
      try {
        await applyReceptionDraftWithClient(client, userId);
      } catch {
        await client.query("ROLLBACK TO SAVEPOINT reception_profile_apply");
        console.error("Reception profile application failed; membership observation preserved");
      }
      await client.query("RELEASE SAVEPOINT reception_profile_apply");
    }
    await client.query("COMMIT");
    return { participantId, changed, shouldInvite };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function checkForumAndInvite(
  userId: string,
  source: "login" | "start",
  database: ForumDatabase = pool,
  bot?: ForumBot,
): Promise<void> {
  const { token, forumChatId } = telegramReceptionConfig();
  if (!token || !forumChatId || !validUserId(userId) || !validTelegramId(forumChatId)) return;
  const c = await database.connect();
  let locked = false;
  let destroy = false;
  try {
    // Same lock as application submission/Guardian decisions: no check-then-send race.
    await c.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [`reception-application:${userId}`]);
    locked = true;
    const bound: ForumDatabase = { query: c.query.bind(c), connect: async () => ({ query: c.query.bind(c), release: () => {} }) };
    await checkForumAndInviteLocked(userId, source, bound, bot);
  } finally {
    if (locked) {
      try { await c.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [`reception-application:${userId}`]); }
      catch { destroy = true; }
    }
    c.release(destroy);
  }
}

async function checkForumAndInviteLocked(userId: string, source: "login" | "start", database: ForumDatabase, bot?: ForumBot): Promise<void> {
  const { token, forumChatId, forumInviteUrl, guardianInvitesEnabled } = telegramReceptionConfig();
  if (!token || !forumChatId || !validUserId(userId) || !validTelegramId(forumChatId)) return;
  const application = await database.query("SELECT id FROM reception_applications WHERE telegram_user_id=$1", [userId]);
  const identity = await database.query(
    `SELECT participant_id FROM external_identities
      WHERE provider = 'telegram' AND external_user_id = $1 LIMIT 1`,
    [userId],
  );
  if (!identity.rowCount) return;
  const reception = bot ?? receptionBot(token);
  const observedAt = new Date();
  const joined = await reception.getMember(forumChatId, userId);
  const observation = await observeForumMembership(database, userId, joined, observedAt,
    forumInviteUrl && guardianInvitesEnabled && !application.rowCount ? source : null);
  if (!observation?.shouldInvite || !forumInviteUrl) return;
  // A join may have arrived after the first check but before the invitation claim.
  const stillAbsent = !(await reception.getMember(forumChatId, userId));
  if (!stillAbsent) {
    await observeForumMembership(database, userId, true, new Date(), null);
    return;
  }
  const delivery = await reception.sendInvite(userId, forumInviteUrl);
  if (delivery === "sent") {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE participant_forum_onboarding SET invitation_sent_at = now()
          WHERE participant_id = $1 AND invitation_sent_at IS NULL`,
        [observation.participantId],
      );
      await client.query(
        `INSERT INTO events(event_type, participant_id, payload)
         VALUES ('onboarding.forum_invitation_sent', $1, '{}'::jsonb)`,
        [observation.participantId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } else if (delivery === "blocked") {
    await database.query(
      `UPDATE participant_forum_onboarding SET invitation_blocked_at = now()
        WHERE participant_id = $1 AND invitation_sent_at IS NULL`,
      [observation.participantId],
    );
  }
}

export async function observeForumMemberUpdate(
  update: unknown,
  database: ForumDatabase = pool,
): Promise<"ignored" | "observed"> {
  const { forumChatId } = telegramReceptionConfig();
  const memberUpdate = record(record(update)?.chat_member);
  const chat = record(memberUpdate?.chat);
  const oldMember = record(memberUpdate?.old_chat_member);
  const newMember = record(memberUpdate?.new_chat_member);
  const user = record(newMember?.user);
  const userId = user?.id;
  const timestamp = memberUpdate?.date;
  if (!forumChatId || !memberUpdate || !chat || String(chat.id) !== forumChatId ||
      !oldMember || !newMember || !Number.isSafeInteger(userId) ||
      !Number.isSafeInteger(timestamp)) return "ignored";
  const status = newMember.status;
  const joined = status === "creator" || status === "administrator" || status === "member" ||
    (status === "restricted" && newMember.is_member === true);
  const oldStatus = oldMember.status;
  const wasJoined = oldStatus === "creator" || oldStatus === "administrator" || oldStatus === "member" ||
    (oldStatus === "restricted" && oldMember.is_member === true);
  const wasAbsent = oldStatus === "left" || oldStatus === "kicked" ||
    (oldStatus === "restricted" && oldMember.is_member === false);
  if (!joined && status !== "left" && status !== "kicked" && status !== "restricted") return "ignored";
  const updateId = record(update)?.update_id;
  const result = await observeForumMembership(database, String(userId), joined,
    new Date(Number(timestamp) * 1000), null, "chat_member",
    Number.isSafeInteger(updateId) ? Number(updateId) : undefined,
    joined && wasAbsent && user?.is_bot !== true,
    { wasJoined, status: String(status) });
  if (result && joined && user?.is_bot !== true) await rememberForumMemberName(database, String(userId), user);
  return result ? "observed" : "ignored";
}

// Core shows a person who has not logged in only under the name they gave themselves in Telegram.
// A name from the MTProto roster is the exporter's own contact label for that person (Telegram returns
// contact names to the account that saved them), so it must never become a public display name.
// Login sets the name from the person's own profile; a name chosen in Core is never touched.
const OWN_NAME = `COALESCE(NULLIF(btrim(concat_ws(' ', identity.first_name, identity.last_name)), ''),
  NULLIF(btrim(identity.username), ''), 'Участник форума')`;
const NAME_FROM_OWN_TELEGRAM = `FROM external_identities identity
  WHERE identity.participant_id = p.id AND identity.provider = 'telegram'
    AND NOT p.display_name_chosen_in_core
    AND NOT EXISTS (SELECT 1 FROM events login WHERE login.participant_id = p.id AND login.event_type = 'participant.logged_in')
    AND p.display_name IS DISTINCT FROM ${OWN_NAME}`;

export async function useOwnTelegramNames(
  database: Pick<ForumDatabase, "query">, apply: boolean, telegramUserId?: string,
): Promise<number> {
  const only = telegramUserId ? " AND identity.external_user_id = $1" : "";
  const values = telegramUserId ? [telegramUserId] : [];
  const result = apply
    ? await database.query(`UPDATE participants p SET display_name = ${OWN_NAME}, updated_at = now() ${NAME_FROM_OWN_TELEGRAM}${only}`, values)
    : await database.query(`SELECT count(*)::integer AS count FROM participants p, LATERAL (SELECT 1 ${NAME_FROM_OWN_TELEGRAM}${only}) own`, values);
  return apply ? result.rowCount ?? 0 : Number(result.rows[0]?.count ?? 0);
}

export async function rememberForumMemberName(
  database: ForumDatabase, userId: string, user: Record<string, unknown> | null,
): Promise<void> {
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 128) : null;
  const firstName = text(user?.first_name), lastName = text(user?.last_name), username = text(user?.username);
  if (!firstName && !lastName && !username) return;
  // Only empty fields: a later login knows better.
  await database.query(
    `UPDATE external_identities identity
        SET username = COALESCE(identity.username, $2), first_name = COALESCE(identity.first_name, $3),
            last_name = COALESCE(identity.last_name, $4), updated_at = now()
      WHERE identity.provider = 'telegram' AND identity.external_user_id = $1
        AND (identity.username IS NULL OR (identity.first_name IS NULL AND identity.last_name IS NULL))`,
    [userId, username, firstName, lastName],
  );
  await useOwnTelegramNames(database, true, userId);
}

// One-off: the reception bot, a forum administrator, reads the name each forum member set in Telegram
// where Core never saw it, then every profile without a login is shown under its own Telegram name.
export async function backfillForumMemberNames(
  database: ForumDatabase, apply: boolean,
  fetchUser?: (userId: string) => Promise<Record<string, unknown> | null>,
): Promise<{ placeholders: number; named: number; unavailable: number; renamed: number }> {
  const { token, forumChatId } = telegramReceptionConfig();
  const read = fetchUser ?? (async (userId: string) => {
    if (!token || !forumChatId) throw new Error("Reception bot is not configured");
    const response = await botRequest(token, "getChatMember", { chat_id: forumChatId, user_id: Number(userId) });
    return response.ok ? record(record(response.result)?.user) : null;
  });
  const pending = await database.query(
    `SELECT identity.external_user_id FROM participants p
       JOIN external_identities identity ON identity.participant_id = p.id AND identity.provider = 'telegram'
      WHERE identity.external_user_id IS NOT NULL
        AND identity.first_name IS NULL AND identity.last_name IS NULL
      ORDER BY p.created_at`);
  const result = { placeholders: pending.rows.length, named: 0, unavailable: 0, renamed: 0 };
  for (const [index, row] of pending.rows.entries()) {
    // Stay well under the Bot API's per-bot request rate.
    if (index && !fetchUser) await new Promise((resolve) => setTimeout(resolve, 60));
    const user = await read(String(row.external_user_id));
    const hasName = [user?.first_name, user?.last_name, user?.username].some((value) => typeof value === "string" && value.trim());
    if (!user || user.is_bot === true || !hasName) { result.unavailable++; continue; }
    result.named++;
    if (apply) await rememberForumMemberName(database, String(row.external_user_id), user);
  }
  // Whoever stays unread falls back to @username or the placeholder: a roster name is never kept.
  result.renamed = await useOwnTelegramNames(database, apply);
  return result;
}
