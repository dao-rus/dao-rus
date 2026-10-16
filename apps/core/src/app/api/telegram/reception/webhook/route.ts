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
  // An authenticated update is always acknowledged. Telegram retries anything that is not 2xx and
  // holds back later updates of the same chat meanwhile, so one refused update (for instance a long
  // forum post) would silently stall every reply written in the forum after it.
  const ignored = () => NextResponse.json({ ok: true, status: "ignored" });
  let update: unknown;
  try {
    const body = await request.text();
    // Telegram escapes non-Latin text, so a full-length message with the message it replies to is tens of kilobytes.
    if (body.length > 512_000) return ignored();
    update = JSON.parse(body);
  } catch {
    return ignored();
  }
  if (!update || typeof update !== "object" || Array.isArray(update)) return ignored();
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
      void (await import("../../../../../lib/reception-voice")).onReceptionRelayed(String(chat.id),
        typeof message.text === "string" ? message.text : null,
        typeof (update as Record<string, unknown>).update_id === "number" ? (update as Record<string, unknown>).update_id as number : null);
    }
    return NextResponse.json({ ok: true, status });
  }
  if (await observeForumMemberUpdate(update) === "observed") {
    await (await import("../../../../../lib/reception-voice")).onForumMemberUpdate(update);
    await (await import("../../../../../lib/guardian-forum-actions")).afterForumMemberUpdate(update);
    await (await import("../../../../../lib/departure-log")).logDepartureAfterUpdate(update);
  }
  return NextResponse.json({ ok: true });
}
