import { pool } from "./db";
import { telegramReceptionConfig } from "./config";
import { findOrCreateParticipantByTelegramId } from "./telegram-participant";
import { DAO_CODE_VERSION } from "./dao-code";
import { readInterfaceTextsWithDatabase } from "./interface-texts";

type Row = Record<string, unknown>;
type Result = { rowCount: number | null; rows: Row[] };
export type HubAdmissionDatabase = {
  query(text: string, values?: unknown[]): Promise<Result>;
  connect(): Promise<{ query(text: string, values?: unknown[]): Promise<Result>; release(): void }>;
};
type TelegramApiResult = { ok?: boolean; error_code?: number; result?: unknown };
type HubBot = (method: string, params: Record<string, unknown>) => Promise<TelegramApiResult>;

function record(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

async function telegram(method: string, params: Record<string, unknown>): Promise<TelegramApiResult> {
  const { token } = telegramReceptionConfig();
  if (!token) return { ok: false };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(params), cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    return await response.json() as TelegramApiResult;
  } catch {
    return { ok: false, error_code: 0 };
  }
}

function validTelegramId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

async function admissionText(database: HubAdmissionDatabase): Promise<string> {
  const { values } = await readInterfaceTextsWithDatabase(database);
  return values["reception.hub.admission_message"];
}

export async function receiveHubJoinRequest(
  update: unknown,
  database: HubAdmissionDatabase = pool,
  bot: HubBot = telegram,
): Promise<"ignored" | "offered" | "duplicate"> {
  const root = record(update), request = record(root?.chat_join_request);
  const chat = record(request?.chat), user = record(request?.from);
  const updateId = root?.update_id, userId = user?.id, date = request?.date, userChatId = request?.user_chat_id;
  if (!Number.isSafeInteger(updateId) || !chat || typeof chat.id !== "number" || !Number.isSafeInteger(chat.id) || !validTelegramId(userId) ||
      !Number.isSafeInteger(date) || !validTelegramId(userChatId)) return "ignored";
  const hub = await database.query(
    `SELECT id, response_timeout FROM telegram_hubs
      WHERE chat_id = $1::bigint AND enabled AND code_version = $2`,
    [String(chat.id), DAO_CODE_VERSION],
  );
  if (!hub.rowCount) return "ignored";

  const insert = await database.query(
    `INSERT INTO telegram_hub_join_requests(hub_id, telegram_user_id, telegram_update_id, request_date, expires_at)
     VALUES ($1, $2, $3, to_timestamp($4), to_timestamp($4) + $5::interval)
     ON CONFLICT DO NOTHING RETURNING id`,
    [hub.rows[0].id, String(userId), String(updateId), date, hub.rows[0].response_timeout],
  );
  const requestRow = insert.rowCount ? insert.rows[0] : (await database.query(
    `SELECT id, telegram_user_id FROM telegram_hub_join_requests
      WHERE (telegram_update_id=$1 OR (hub_id=$2 AND telegram_user_id=$3)) AND status='pending'
      ORDER BY request_date DESC LIMIT 1`, [String(updateId), hub.rows[0].id, String(userId)],
  )).rows[0];
  if (!requestRow) return "duplicate";
  if (requestRow.telegram_user_id !== undefined && requestRow.telegram_user_id !== String(userId)) return "duplicate";
  const id = String(requestRow.id);
  const params = {
    chat_id: userChatId,
    text: await admissionText(database),
    reply_markup: { inline_keyboard: [[
      { text: "Принимаю", callback_data: `ha:yes:${id}` },
      { text: "Не принимаю", callback_data: `ha:no:${id}` },
    ]] },
  };
  // Telegram's user_chat_id is the preferred short-lived channel. If unavailable,
  // try a normal user DM; /start hub can retrieve the pending request later.
  const sent = await bot("sendMessage", params);
  if (!sent.ok) await bot("sendMessage", { ...params, chat_id: userId });
  return "offered";
}

async function answerCallback(bot: HubBot, callbackId: string, text: string, alert = false) {
  await bot("answerCallbackQuery", { callback_query_id: callbackId, text, show_alert: alert });
}

async function setStatus(database: HubAdmissionDatabase, requestId: string, from: string, to: string) {
  await database.query(
    `UPDATE telegram_hub_join_requests SET status=$3, decided_at=now()
      WHERE id=$1::uuid AND status=$2`, [requestId, from, to],
  );
}

async function retryDecision(database: HubAdmissionDatabase, row: Row, errorCode: string) {
  await database.query(
    `UPDATE telegram_hub_join_requests
        SET attempts=attempts+1,
            retry_at=now() + make_interval(secs => LEAST(3600, 5 * power(2, LEAST(attempts, 9))::integer)),
            last_error_code=$3
      WHERE id=$1::uuid AND status=$2`,
    [row.id, row.status, errorCode.slice(0, 100)],
  );
}

async function reconcileTelegramDecision(
  database: HubAdmissionDatabase, row: Row, bot: HubBot,
): Promise<void> {
  const approve = row.status === "approval_pending";
  const method = approve ? "approveChatJoinRequest" : "declineChatJoinRequest";
  const result = await bot(method, { chat_id: String(row.chat_id), user_id: Number(row.telegram_user_id) });
  if (result.ok) {
    await setStatus(database, String(row.id), String(row.status), approve ? "approved" : "declined");
    return;
  }
  // Another administrator may already have approved the same request.
  if (approve) {
    const member = await bot("getChatMember", { chat_id: String(row.chat_id), user_id: Number(row.telegram_user_id) });
    const status = record(member.result)?.status;
    if (member.ok && ["creator", "administrator", "member"].includes(String(status))) {
      await setStatus(database, String(row.id), "approval_pending", "approved");
      return;
    }
  }
  await retryDecision(database, row, `telegram_${approve ? "approve" : "decline"}_${result.error_code ?? "unknown"}`);
}

export async function handleHubAdmissionCallback(
  update: unknown, database: HubAdmissionDatabase = pool, bot: HubBot = telegram,
): Promise<"ignored" | "handled"> {
  const callback = record(record(update)?.callback_query), data = callback?.data;
  const actor = record(callback?.from), callbackId = callback?.id;
  if (typeof data !== "string" || typeof callbackId !== "string" || !validTelegramId(actor?.id)) return "ignored";
  const match = /^ha:(yes|no):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu.exec(data);
  if (!match) return "ignored";
  const client = await database.connect();
  let decision: Row | null = null;
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT r.*, h.chat_id FROM telegram_hub_join_requests r
        JOIN telegram_hubs h ON h.id=r.hub_id WHERE r.id=$1::uuid FOR UPDATE OF r`, [match[2]],
    );
    const row = found.rows[0];
    if (!row || row.telegram_user_id !== String(actor.id) || row.status !== "pending" ||
        new Date(String(row.expires_at)).getTime() <= Date.now()) {
      await client.query("COMMIT");
      await answerCallback(bot, callbackId, "Заявка уже обработана или срок ответа истёк.", true);
      return "handled";
    }
    if (match[1] === "no") {
      await client.query(`UPDATE telegram_hub_join_requests SET status='refused', decided_at=now() WHERE id=$1`, [row.id]);
      decision = { ...row, status: "refused" };
    } else {
      const participantId = await findOrCreateParticipantByTelegramId(client, String(actor.id), "telegram_reception");
      const acceptedAt = new Date();
      await client.query(
        `INSERT INTO telegram_hub_memberships(hub_id, participant_id, telegram_user_id, accepted_at, code_version, join_request_id)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (hub_id,participant_id) DO NOTHING`,
        [row.hub_id, participantId, String(actor.id), acceptedAt, DAO_CODE_VERSION, row.id],
      );
      await client.query(
        `UPDATE telegram_hub_join_requests SET status='approval_pending', participant_id=$2, accepted_at=$3, decided_at=$3
          WHERE id=$1`, [row.id, participantId, acceptedAt],
      );
      decision = { ...row, status: "approval_pending", participant_id: participantId, accepted_at: acceptedAt };
    }
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* keep the database error */ }
    throw error;
  } finally { client.release(); }

  if (decision) await reconcileTelegramDecision(database, decision, bot);
  await answerCallback(bot, callbackId, match[1] === "yes" ? "Согласие сохранено." : "Заявка отклонена.");
  return "handled";
}

export async function handleHubStart(
  telegramUserId: string, database: HubAdmissionDatabase = pool, bot: HubBot = telegram,
): Promise<boolean> {
  if (!/^[1-9][0-9]{0,15}$/.test(telegramUserId)) return false;
  const pending = await database.query(
    `SELECT r.id, h.chat_id FROM telegram_hub_join_requests r JOIN telegram_hubs h ON h.id=r.hub_id
      WHERE r.telegram_user_id=$1 AND r.status='pending' AND r.expires_at>now() AND h.enabled
      ORDER BY r.request_date DESC LIMIT 1`, [telegramUserId],
  );
  if (!pending.rowCount) return false;
  const id = String(pending.rows[0].id);
  await bot("sendMessage", { chat_id: Number(telegramUserId), text: await admissionText(database), reply_markup: { inline_keyboard: [[
    { text: "Принимаю", callback_data: `ha:yes:${id}` },
    { text: "Не принимаю", callback_data: `ha:no:${id}` },
  ]] } });
  return true;
}

/** Process due decisions from the existing worker; no new service is required. */
export async function processHubAdmissionDecisions(
  database: HubAdmissionDatabase = pool, bot: HubBot = telegram,
): Promise<void> {
  await database.query(
    `UPDATE telegram_hub_join_requests SET status='expired', decided_at=now()
      WHERE id IN (SELECT id FROM telegram_hub_join_requests
        WHERE status='pending' AND expires_at<=now() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 50)
      RETURNING id`,
  );
  // Expiry is its own terminal reason in Core and is reconciled as a Telegram decline.
  const due = await database.query(
    `SELECT r.*, h.chat_id FROM telegram_hub_join_requests r JOIN telegram_hubs h ON h.id=r.hub_id
      WHERE r.status IN ('approval_pending','refused','expired') AND (r.retry_at IS NULL OR r.retry_at<=now())
      ORDER BY r.created_at LIMIT 50`,
  );
  for (const row of due.rows) await reconcileTelegramDecision(database, row, bot);
}

export const hubAdmissionInternals = { admissionText, telegram };
