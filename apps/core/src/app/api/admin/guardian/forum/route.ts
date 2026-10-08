import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl, hasPrototypeAdminAccess, telegramReceptionConfig } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { readInterfaceTexts } from "@/lib/interface-texts";
import { listSignalTypes, SignalValidationError } from "@/lib/signals";
import {
  ForumBotError, GUARDIAN_FEATURES, discussionTopicKey, normalizeBotUsername, parseChannelId, parseTopicLink, productionForumBot,
  saveGuardianForumSettings, type GuardianFeature,
} from "@/lib/guardian-forum";

export const runtime = "nodejs";

function forumRedirect(status: string, detail?: string) {
  const url = new URL("/admin/guardian/forum", appBaseUrl());
  url.searchParams.set("forum_update", status);
  if (detail) url.searchParams.set("detail", detail.slice(0, 200));
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(appBaseUrl()).origin) return new NextResponse("Forbidden", { status: 403 });
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  if (!hasPrototypeAdminAccess(participant.id)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData();
  const forumChatId = telegramReceptionConfig().forumChatId;
  try {
    const keys = ["topic.newcomers", ...(await listSignalTypes()).filter((type) => type.key !== "dating").map((type) => discussionTopicKey(type.key))];
    const topics = Object.fromEntries(keys.map((key) => [key, parseTopicLink(form.get(key), forumChatId)]));
    const features = Object.fromEntries(GUARDIAN_FEATURES.map((feature) => [feature, form.get(`feature.${feature}`) === "on"])) as Record<GuardianFeature, boolean>;
    const rawChannel = String(form.get("channel.departures") ?? "").trim();
    const departuresChannel = parseChannelId(rawChannel);
    if (rawChannel && !departuresChannel) throw new SignalValidationError("Invalid departures channel");
    const changed = await saveGuardianForumSettings(participant.id, { features, botUsername: normalizeBotUsername(form.get("miniapp.bot")), topics, departuresChannel });
    const test = form.get("test");
    if (test === "channel.departures") {
      const { telegramBotToken } = await import("@/lib/config");
      const token = telegramBotToken();
      if (!token || !departuresChannel) return forumRedirect("test_failed", departuresChannel ? "бот не настроен на сервере" : "канал уходов не указан");
      const { channelSender } = await import("@/lib/departure-log");
      const { values: texts } = await readInterfaceTexts();
      await channelSender(token, departuresChannel)(texts["forum.departure_test"]);
      return forumRedirect("test_ok");
    }
    if (typeof test === "string" && test) {
      const topic = topics[test];
      const forum = await productionForumBot();
      if (!topic || !forum) return forumRedirect("test_failed", topic ? "бот или форум не настроены на сервере" : "для этой ветки не указана ссылка");
      const { values: texts } = await readInterfaceTexts();
      await forum.bot.send(topic, texts["forum.test_message"], []);
      return forumRedirect("test_ok");
    }
    return forumRedirect(changed.length ? "saved" : "unchanged");
  } catch (error) {
    if (error instanceof ForumBotError) return forumRedirect("test_failed", error.detail);
    if (error instanceof SignalValidationError) return forumRedirect("invalid");
    throw error;
  }
}
