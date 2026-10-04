import { appBaseUrl, telegramBotToken } from "./config";

type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
export type DeliveryClient = { query(text: string, values?: unknown[]): Promise<QueryResult>; release(): void };
export type DeliveryDatabase = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  connect(): Promise<DeliveryClient>;
};

export type DeliveryStatus = "sent" | "blocked" | "failed" | "unknown";
export type DeliveryOutcome = {
  status: DeliveryStatus;
  messageId?: string;
  errorCode?: string;
  errorText?: string;
};
export type ClaimedDelivery = {
  id: string;
  participantId: string;
  text: string;
  actionUrl: string | null;
  actionLabel: string | null;
};

const REQUEST_TIMEOUT_MS = 8000;

export async function expireStaleDeliveries(database: Pick<DeliveryDatabase, "query">): Promise<string[]> {
  const result = await database.query(
    `UPDATE notification_deliveries
        SET status = 'unknown', error_code = 'claim_expired',
            error_text = 'Processing expired without a confirmed result'
      WHERE status = 'processing'
        AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
      RETURNING id`,
  );
  return result.rows.map((row) => String(row.id));
}

export async function claimPendingDelivery(database: Pick<DeliveryDatabase, "connect">): Promise<ClaimedDelivery | null> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `WITH candidate AS (
         SELECT delivery.id, notification.participant_id, notification.text,
                notification.action_url, notification.action_label
           FROM notification_deliveries delivery
           JOIN notifications notification ON notification.id = delivery.notification_id
          WHERE delivery.channel = 'telegram' AND delivery.status = 'pending'
          ORDER BY delivery.created_at, delivery.id
          FOR UPDATE OF delivery SKIP LOCKED
          LIMIT 1
       )
       UPDATE notification_deliveries delivery
          SET status = 'processing', claimed_at = clock_timestamp()
         FROM candidate
        WHERE delivery.id = candidate.id
       RETURNING delivery.id, candidate.participant_id, candidate.text,
                 candidate.action_url, candidate.action_label`,
    );
    await client.query("COMMIT");
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      id: String(row.id),
      participantId: String(row.participant_id),
      text: String(row.text),
      actionUrl: row.action_url ? String(row.action_url) : null,
      actionLabel: row.action_label ? String(row.action_label) : null,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function recipientTelegramId(database: Pick<DeliveryDatabase, "query">, participantId: string): Promise<number | null> {
  const result = await database.query(
    `SELECT identity.external_user_id,
            EXISTS (
              SELECT 1 FROM external_identities other
               WHERE other.provider = 'telegram' AND other.id <> identity.id
                 AND (other.external_user_id = identity.external_user_id
                   OR other.provider_subject = 'roster:' || identity.external_user_id)
            ) OR EXISTS (
              SELECT 1 FROM telegram_roster_entries roster
               WHERE roster.telegram_user_id::text = identity.external_user_id
                 AND roster.participant_id IS NOT NULL
                 AND roster.participant_id <> identity.participant_id
            ) OR (identity.provider_subject LIKE 'roster:%'
              AND identity.provider_subject <> 'roster:' || identity.external_user_id) AS identity_conflict
       FROM external_identities identity
      WHERE identity.participant_id = $1::uuid AND identity.provider = 'telegram'`,
    [participantId],
  );
  if (result.rowCount !== 1) return null;
  if (result.rows[0].identity_conflict === true) return null;
  const raw = result.rows[0].external_user_id;
  if (typeof raw !== "string" || !/^[1-9]\d*$/u.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export function telegramActionUrl(actionUrl: string | null, baseUrl: string): string | null {
  if (actionUrl === null) return null;
  if (/^https:\/\//iu.test(actionUrl)) {
    const parsed = new URL(actionUrl);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return actionUrl;
    throw new Error("Invalid action URL");
  }
  if (!actionUrl.startsWith("/") || actionUrl.startsWith("//") || actionUrl.includes("\\") || /[\u0000-\u001f]/u.test(actionUrl)) {
    throw new Error("Invalid action URL");
  }
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("Invalid Core base URL");
  return new URL(actionUrl, base).toString();
}

export async function sendTelegramDelivery(
  token: string,
  chatId: number,
  text: string,
  actionUrl: string | null,
  actionLabel: string | null,
  request: typeof fetch = fetch,
): Promise<DeliveryOutcome> {
  try {
    const response = await request(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(actionUrl ? { reply_markup: { inline_keyboard: [[{ text: actionLabel ?? "Открыть", url: actionUrl }]] } } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status >= 500) {
      return { status: "unknown", errorCode: "telegram_server_error", errorText: "Telegram server result is ambiguous" };
    }
    let data: unknown;
    try { data = await response.json(); } catch {
      return { status: "unknown", errorCode: "telegram_invalid_response", errorText: "Telegram response could not be read" };
    }
    if (!data || typeof data !== "object") {
      return { status: "unknown", errorCode: "telegram_invalid_response", errorText: "Telegram response could not be read" };
    }
    const body = data as { ok?: unknown; error_code?: unknown; result?: { message_id?: unknown } };
    if (response.ok && body.ok === true) {
      const id = body.result?.message_id;
      return typeof id === "number" && Number.isSafeInteger(id) && id > 0
        ? { status: "sent", messageId: String(id) }
        : { status: "unknown", errorCode: "telegram_invalid_response", errorText: "Telegram message ID was missing" };
    }
    if (body.ok === false) {
      const code = typeof body.error_code === "number" ? body.error_code : response.status;
      if (code === 403) return { status: "blocked", errorCode: "telegram_403", errorText: "Telegram forbade delivery" };
      if (code >= 400 && code < 500 && response.status < 500) {
        return { status: "failed", errorCode: `telegram_${code}`, errorText: "Telegram rejected delivery" };
      }
    }
    return { status: "unknown", errorCode: "telegram_invalid_response", errorText: "Telegram response could not be interpreted" };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return name === "TimeoutError" || name === "AbortError"
      ? { status: "unknown", errorCode: "telegram_timeout", errorText: "Telegram request timed out" }
      : { status: "unknown", errorCode: "telegram_network_error", errorText: "Telegram network result is ambiguous" };
  }
}

async function markAttempt(database: Pick<DeliveryDatabase, "query">, id: string): Promise<boolean> {
  const result = await database.query(
    `UPDATE notification_deliveries SET attempted_at = clock_timestamp()
      WHERE id = $1::uuid AND status = 'processing' AND attempted_at IS NULL
      RETURNING id`,
    [id],
  );
  return Boolean(result.rowCount);
}

async function finishDelivery(database: Pick<DeliveryDatabase, "query">, id: string, outcome: DeliveryOutcome): Promise<boolean> {
  const result = await database.query(
    `UPDATE notification_deliveries
        SET status = $2, external_message_id = $3, error_code = $4, error_text = $5
      WHERE id = $1::uuid AND status = 'processing'
      RETURNING id`,
    [id, outcome.status, outcome.messageId ?? null, outcome.errorCode ?? null, outcome.errorText ?? null],
  );
  return Boolean(result.rowCount);
}

export async function processNextNotificationDelivery(
  database: DeliveryDatabase,
  enabled: boolean,
  request: typeof fetch = fetch,
): Promise<{ id: string; status: DeliveryStatus; errorCode?: string } | null> {
  if (!enabled) return null;
  const delivery = await claimPendingDelivery(database);
  if (!delivery) return null;

  let outcome: DeliveryOutcome | null = null;
  const chatId = await recipientTelegramId(database, delivery.participantId);
  if (chatId === null) {
    outcome = { status: "failed", errorCode: "invalid_telegram_identity", errorText: "Recipient Telegram identity is missing or invalid" };
  } else {
    const token = telegramBotToken();
    if (!token) {
      outcome = { status: "failed", errorCode: "dev_bot_unconfigured", errorText: "DAO Rus Dev bot is not configured" };
    } else {
      let actionUrl: string | null | undefined;
      try { actionUrl = telegramActionUrl(delivery.actionUrl, appBaseUrl()); } catch {
        actionUrl = undefined;
        outcome = { status: "failed", errorCode: "invalid_action_url", errorText: "Notification action URL is invalid" };
      }
      if (actionUrl !== undefined) {
        if (!await markAttempt(database, delivery.id)) return { id: delivery.id, status: "unknown", errorCode: "claim_expired" };
        outcome = await sendTelegramDelivery(token, chatId, delivery.text, actionUrl, delivery.actionLabel, request);
      }
    }
  }
  const finalOutcome: DeliveryOutcome = outcome ?? {
    status: "unknown", errorCode: "internal_state", errorText: "Delivery result was not determined",
  };
  const finalized = await finishDelivery(database, delivery.id, finalOutcome);
  return finalized
    ? { id: delivery.id, status: finalOutcome.status, errorCode: finalOutcome.errorCode }
    : { id: delivery.id, status: "unknown", errorCode: "claim_expired" };
}
