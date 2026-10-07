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

export async function POST(request: NextRequest) {
  const { webhookSecret, forumChatId, token, topicId } = telegramReceptionConfig();
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
  if (chat?.type === "private" && typeof message?.text === "string" &&
      (message.text === "/start" || message.text === "/start core") &&
      typeof from?.id === "number" && Number.isSafeInteger(from.id) && chat.id === from.id) {
    await checkForumAndInvite(String(from.id), "start");
    // A bare "Запустить" from someone outside the forum is the door: invite them to introduce themselves.
    if (message.text === "/start") await (await import("../../../../../lib/reception-voice")).onReceptionStart(String(from.id));
    return NextResponse.json({ ok: true });
  }
  if (message) {
    // Keep the update queued at Telegram if the relay was not configured yet.
    if (!token || !topicId) return new NextResponse("Reception relay is not configured", { status: 503 });
    const status = await relayReceptionUpdate(update);
    if (status === "sent" && chat?.type === "private" && typeof chat.id === "number") {
      await (await import("../../../../../lib/reception-voice")).onReceptionRelayed(String(chat.id));
    }
    return NextResponse.json({ ok: true, status });
  }
  if (await observeForumMemberUpdate(update) === "observed") {
    await (await import("../../../../../lib/reception-voice")).onForumMemberUpdate(update);
    await (await import("../../../../../lib/guardian-forum-actions")).afterForumMemberUpdate(update);
  }
  return NextResponse.json({ ok: true });
}
