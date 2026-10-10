import { telegramReceptionConfig } from "./config";
import { pool } from "./db";

type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
export type ReceptionRelayDatabase = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

export type CopyResult =
  | { status: "sent"; messageId: number; headingId?: number }
  | { status: "failed"; errorCode: string };

export type ReceptionRelayBot = {
  sendAttribution(input: { chatId: string; text: string; topicId?: number; entities?: unknown[] }): Promise<CopyResult>;
  copyMessage(input: {
    chatId: string;
    fromChatId: string;
    messageId: number;
    topicId?: number;
  }): Promise<CopyResult>;
};

export type ReceptionRelayResult = "ignored" | "duplicate" | "sent" | "failed" | "unsupported";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function safeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function supportedMessage(message: Record<string, unknown>): boolean {
  if (typeof message.text === "string") return true;
  return ["photo", "video", "document", "audio", "voice", "video_note",
    "animation", "sticker", "contact", "location", "venue"].some((field) =>
    message[field] !== undefined);
}

function attribution(from: Record<string, unknown>): string {
  const oneLine = (value: unknown) => typeof value === "string"
    ? value.trim().replace(/\s+/gu, " ") : "";
  const name = [oneLine(from.first_name), oneLine(from.last_name)].filter(Boolean).join(" ") || "Пользователь Telegram";
  const username = oneLine(from.username);
  return `От: ${name}${username ? ` (@${username})` : ""}`;
}

// Retain only allowlisted diagnostic categories, never Telegram's arbitrary response text.
export function receptionErrorCode(body: Record<string, unknown>): string {
  const code = safeInteger(body.error_code) ? `telegram_${body.error_code}` : "invalid_response";
  const description = typeof body.description === "string" ? body.description.toLowerCase() : "";
  const reasons: Array<[string, string]> = [
    ["can't parse entities", "parse_entities"], ["message thread not found", "topic_not_found"],
    ["topic_closed", "topic_closed"], ["not enough rights", "posting_forbidden"],
    ["bot was kicked", "bot_kicked"], ["bot is not a member", "bot_not_member"],
    ["bot was blocked", "bot_blocked"], ["chat not found", "chat_not_found"],
    ["message to copy not found", "source_not_found"], ["message can't be copied", "source_not_copyable"],
    ["message is too long", "message_too_long"], ["unauthorized", "unauthorized"],
  ];
  const reason = reasons.find(([fragment]) => description.includes(fragment))?.[1];
  const parameters = record(body.parameters);
  const delay = safeInteger(parameters?.retry_after) && parameters.retry_after > 0 ? parameters.retry_after : null;
  return code + (reason ? `_${reason}` : "") + (code === "telegram_429" && delay ? `_retry_after_${delay}` : "");
}

export function deterministicReceptionFailure(code: string | null): boolean {
  return /^(attribution_)?telegram_(400|401|403|404|429)(_|$)/.test(code ?? "");
}

async function botMessage(token: string, method: "sendMessage" | "copyMessage", params: object): Promise<CopyResult> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const body = record(await response.json());
    const result = record(body?.result);
    if (body?.ok === true && safeInteger(result?.message_id)) {
      return { status: "sent", messageId: result.message_id };
    }
    return { status: "failed", errorCode: receptionErrorCode(body ?? {}) };
  } catch {
    // A timeout may occur after Telegram accepted the message. Do not resend automatically.
    return { status: "failed", errorCode: "network_or_timeout" };
  }
}

export function receptionRelayBot(token: string): ReceptionRelayBot {
  return {
    sendAttribution({ chatId, text, topicId, entities }) {
      return botMessage(token, "sendMessage", {
        chat_id: chatId, text, link_preview_options: { is_disabled: true },
        ...(entities?.length ? { entities } : {}),
        ...(topicId === undefined ? {} : { message_thread_id: topicId }),
      });
    },
    copyMessage({ chatId, fromChatId, messageId, topicId }) {
      return botMessage(token, "copyMessage", {
        chat_id: chatId,
        from_chat_id: fromChatId,
        message_id: messageId,
        ...(topicId === undefined ? {} : { message_thread_id: topicId }),
      });
    },
  };
}

let forumDelivery = Promise.resolve();
function enqueueForumDelivery(task: () => Promise<CopyResult>): Promise<CopyResult> {
  const next = forumDelivery.then(task);
  forumDelivery = next.then(() => undefined, () => undefined);
  return next;
}

export async function relayReceptionUpdate(
  update: unknown,
  database: ReceptionRelayDatabase = pool,
  bot?: ReceptionRelayBot,
): Promise<ReceptionRelayResult> {
  const { token, forumChatId, topicId } = telegramReceptionConfig();
  const forumId = Number(forumChatId);
  const threadId = Number(topicId);
  if (!token || !forumChatId || !topicId || !safeInteger(forumId) || !safeInteger(threadId) || threadId <= 0) {
    return "ignored";
  }
  const root = record(update);
  const message = record(root?.message);
  const chat = record(message?.chat);
  const from = record(message?.from);
  if (!safeInteger(root?.update_id) || !message || !chat ||
      !safeInteger(chat.id) || !safeInteger(message.message_id)) return "ignored";

  const isPrivate = chat.type === "private" && safeInteger(from?.id) &&
    from.id === chat.id && from.is_bot !== true;
  const senderChat = record(message.sender_chat);
  // Telegram's General topic has ID 1, but its messages are not marked as topic messages.
  const inReceptionTopic = threadId === 1
    ? message.is_topic_message !== true
    : message.message_thread_id === threadId;
  const isForumReply = chat.id === forumId && inReceptionTopic &&
    (from?.is_bot !== true || senderChat?.id === forumId) &&
    (safeInteger(from?.id) || senderChat?.id === forumId);
  let direction: "private_to_forum" | "forum_to_private";
  let privateChatId: number;
  let sourceMessageId: number;
  let replyForumMessageId: number | null = null;
  if (isPrivate) {
    direction = "private_to_forum";
    privateChatId = chat.id as number;
    sourceMessageId = message.message_id as number;
  } else if (isForumReply) {
    const reply = record(message.reply_to_message);
    if (!safeInteger(reply?.message_id)) return "ignored";
    replyForumMessageId = reply.message_id;
    const mapping = await database.query(
      `SELECT private_chat_id FROM reception_relay_updates
        WHERE forum_chat_id = $1 AND status = 'sent'
          AND (forum_message_id = $2 OR forum_heading_message_id = $2)
        LIMIT 1`,
      [forumChatId, replyForumMessageId],
    );
    if (!mapping.rowCount) return "ignored";
    privateChatId = Number(mapping.rows[0].private_chat_id);
    if (!safeInteger(privateChatId) || privateChatId <= 0) return "ignored";
    direction = "forum_to_private";
    sourceMessageId = message.message_id as number;
  } else {
    return "ignored";
  }

  const updateId = root.update_id as number;
  const supported = supportedMessage(message);
  const claimed = await database.query(
    `INSERT INTO reception_relay_updates(
       update_id, direction, forum_chat_id, private_chat_id,
       private_message_id, forum_message_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (update_id) DO NOTHING RETURNING update_id`,
    [updateId, direction, forumChatId, String(privateChatId),
      direction === "private_to_forum" ? sourceMessageId : null,
      direction === "forum_to_private" ? sourceMessageId : null,
      supported ? "pending" : "unsupported"],
  );
  if (!claimed.rowCount) return "duplicate";
  if (!supported) return "unsupported";

  const relayBot = bot ?? receptionRelayBot(token);
  const copied = direction === "private_to_forum"
    ? await enqueueForumDelivery(async () => {
      // Bot API rejects message_thread_id=1 for General; omitting it targets General.
      const topic = threadId !== 1 ? { topicId: threadId } : {};
      const name = attribution(from!);
      // A text message arrives as one forum message, name on top: whichever way a member presses
      // "reply", the answer finds its way back. Formatting is kept by shifting its offsets.
      const prefix = name + "\n\n";
      if (typeof message.text === "string" && prefix.length + message.text.length <= 4096) {
        const entities = Array.isArray(message.entities) ? message.entities.flatMap((entry) => {
          const entity = record(entry);
          return entity && safeInteger(entity.offset) ? [{ ...entity, offset: entity.offset + prefix.length }] : [];
        }) : [];
        const single = await relayBot.sendAttribution({ chatId: forumChatId, text: prefix + message.text, entities, ...topic });
        // Telegram may refuse some formatting from a bot; the words matter more than the styling.
        return single.status === "failed" && single.errorCode === "telegram_400_parse_entities" && entities.length
          ? relayBot.sendAttribution({ chatId: forumChatId, text: prefix + message.text, ...topic }) : single;
      }
      const heading = await relayBot.sendAttribution({ chatId: forumChatId, text: name, ...topic });
      if (heading.status === "failed") {
        return { status: "failed", errorCode: `attribution_${heading.errorCode}` };
      }
      // Save the successful heading before the second external call, also when the copy fails.
      await database.query(`UPDATE reception_relay_updates SET forum_heading_message_id=$2,
        updated_at=now() WHERE update_id=$1 AND status='pending'`, [updateId, heading.messageId]);
      const copy = await relayBot.copyMessage({
        chatId: forumChatId, fromChatId: String(privateChatId),
        messageId: sourceMessageId, ...topic,
      });
      return copy.status === "sent" ? { ...copy, headingId: heading.messageId } : copy;
    })
    : await relayBot.copyMessage({
      chatId: String(privateChatId), fromChatId: forumChatId,
      messageId: sourceMessageId,
    });
  if (copied.status === "failed") {
    await database.query(
      `UPDATE reception_relay_updates SET status = 'failed', error_code = $2,
         updated_at = now() WHERE update_id = $1 AND status = 'pending'`,
      [updateId, copied.errorCode],
    );
    console.error(JSON.stringify({event:"reception_relay_failed",updateId,direction,errorCode:copied.errorCode,
      recovery:deterministicReceptionFailure(copied.errorCode)?"fix_cause_then_manual_recovery":"verify_delivery_before_manual_recovery"}));
    return "failed";
  }
  await database.query(
    `UPDATE reception_relay_updates
       SET status = 'sent',
           private_message_id = COALESCE(private_message_id, $2::bigint),
           forum_message_id = COALESCE(forum_message_id, $3::bigint),
           forum_heading_message_id = $4::bigint,
           updated_at = now()
     WHERE update_id = $1 AND status = 'pending'`,
    [updateId,
      direction === "forum_to_private" ? copied.messageId : null,
      direction === "private_to_forum" ? copied.messageId : null,
      copied.headingId ?? null],
  );
  return "sent";
}
