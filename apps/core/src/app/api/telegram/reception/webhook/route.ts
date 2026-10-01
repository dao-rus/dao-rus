import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { telegramReceptionConfig } from "@/lib/config";
import { checkForumAndInvite, observeForumMemberUpdate } from "@/lib/telegram-forum-onboarding";
import { relayReceptionUpdate } from "@/lib/telegram-reception-relay";

export const runtime = "nodejs";

function sameSecret(received: string | null, expected: string): boolean {
  if (!received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function safeId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function updateType(update: Record<string, unknown>): string {
  const types = ["message", "chat_member", "edited_message", "my_chat_member",
    "callback_query", "channel_post", "edited_channel_post"];
  return types.find((type) => type in update) ?? "other";
}

export async function POST(request: NextRequest) {
  const { webhookSecret, forumChatId, token, topicId, diagnosticsEnabled } = telegramReceptionConfig();
  if (!webhookSecret || !forumChatId) {
    return new NextResponse("Reception is not configured", { status: 503 });
  }
  if (!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), webhookSecret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  let update: unknown;
  try {
    const body = await request.text();
    if (body.length > 20_000) return new NextResponse("Invalid update", { status: 400 });
    update = JSON.parse(body);
  } catch {
    return new NextResponse("Invalid update", { status: 400 });
  }
  if (!update || typeof update !== "object" || Array.isArray(update)) {
    return new NextResponse("Invalid update", { status: 400 });
  }
  const message = "message" in update && update.message && typeof update.message === "object"
    ? update.message as Record<string, unknown> : null;
  const chat = message?.chat && typeof message.chat === "object"
    ? message.chat as Record<string, unknown> : null;
  const from = message?.from && typeof message.from === "object"
    ? message.from as Record<string, unknown> : null;
  const details = update as Record<string, unknown>;
  const log = (branch: string, reason: string, relayResult?: string) => {
    if (!diagnosticsEnabled) return;
    console.info("telegram_reception_update", JSON.stringify({
      update_id: safeId(details.update_id),
      update_type: updateType(details),
      message_id: safeId(message?.message_id),
      chat_id: safeId(chat?.id),
      chat_type: ["private", "group", "supergroup", "channel"].includes(String(chat?.type))
        ? chat?.type : null,
      has_message_thread_id: message ? Object.hasOwn(message, "message_thread_id") : false,
      message_thread_id: safeId(message?.message_thread_id),
      has_text: typeof message?.text === "string",
      branch,
      reason,
      ...(relayResult === undefined ? {} : { relay_result: relayResult,
        copy_attempted: relayResult === "sent" || relayResult === "failed" }),
    }));
  };
  if (chat?.type === "private" && typeof message?.text === "string" &&
      (message.text === "/start" || message.text === "/start core") &&
      typeof from?.id === "number" && Number.isSafeInteger(from.id) && chat.id === from.id) {
    log("start", "private_start_command");
    await checkForumAndInvite(String(from.id), "start");
    return NextResponse.json({ ok: true });
  }
  if (message) {
    // Keep the update queued at Telegram if the relay was not configured yet.
    if (!token || !topicId) {
      log("ignored", "relay_not_configured");
      return new NextResponse("Reception relay is not configured", { status: 503 });
    }
    const isPrivate = chat?.type === "private" && chat?.id === from?.id && from?.is_bot !== true;
    const isForum = safeId(chat?.id) !== null && String(chat?.id) === forumChatId;
    const inTopic = topicId === "1" ? message.is_topic_message !== true
      : message.message_thread_id === Number(topicId);
    const branch = isPrivate ? "private_relay" : isForum && inTopic && message.reply_to_message
      ? "forum_reply" : "ignored";
    let status: Awaited<ReturnType<typeof relayReceptionUpdate>>;
    try {
      status = await relayReceptionUpdate(update);
    } catch (error) {
      log(branch, "handler_error");
      throw error;
    }
    const reason = status === "ignored" ? isForum && !inTopic ? "wrong_topic"
      : isForum && !message.reply_to_message ? "no_reply" : "relay_not_applicable"
      : "relay_processed";
    log(branch, reason, status);
    return NextResponse.json({ ok: true, status });
  }
  log("chat_member" in details ? "chat_member" : "ignored",
    "chat_member" in details ? "membership_update" : "unsupported_update_type");
  await observeForumMemberUpdate(update);
  return NextResponse.json({ ok: true });
}
