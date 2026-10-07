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
    return { status: "failed", errorCode: safeInteger(body?.error_code)
      ? `telegram_${body.error_code}` : "invalid_response" };
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
        return single.status === "failed" && entities.length
          ? relayBot.sendAttribution({ chatId: forumChatId, text: prefix + message.text, ...topic }) : single;
      }
      const heading = await relayBot.sendAttribution({ chatId: forumChatId, text: name, ...topic });
      if (heading.status === "failed") {
        return { status: "failed", errorCode: `attribution_${heading.errorCode}` };
      }
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
