import { NextRequest, NextResponse } from "next/server";
import { telegramBotToken, secureCookies, sessionTtlDays } from "@/lib/config";
import { resolveTelegramParticipant } from "@/lib/identity";
import { PostgresIdentityStore } from "@/lib/postgres-identity-store";
import { createSession, SESSION_COOKIE } from "@/lib/session";
import { checkForumAndInvite } from "@/lib/telegram-forum-onboarding";
import { TelegramMiniAppAuthError, verifyTelegramMiniAppInitData } from "../../../../../lib/telegram-mini-app";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const token = telegramBotToken();
  if (!token) {
    return new NextResponse("Telegram Mini App login is unavailable", { status: 503 });
  }

  let initData: unknown;
  try {
    const rawBody = await request.text();
    if (rawBody.length > 20_000) {
      return new NextResponse("Invalid Telegram Mini App login", { status: 400 });
    }
    const body = JSON.parse(rawBody);
    initData = body?.initData;
  } catch {
    return new NextResponse("Invalid Telegram Mini App login", { status: 400 });
  }

  if (typeof initData !== "string") {
    return new NextResponse("Invalid Telegram Mini App login", { status: 400 });
  }

  let profile;
  try {
    profile = verifyTelegramMiniAppInitData(initData, token);
  } catch (error) {
    if (error instanceof TelegramMiniAppAuthError) {
      return new NextResponse("Invalid or expired Telegram Mini App login", { status: 401 });
    }
    throw error;
  }

  const { participant } = await resolveTelegramParticipant(
    new PostgresIdentityStore(),
    profile,
  );
  const sessionToken = await createSession(participant.id);
  await checkForumAndInvite(profile.telegramUserId, "login").catch(() => undefined);
  const response = NextResponse.json({ ok: true, returnTo: "/need" });
  response.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: sessionTtlDays() * 24 * 60 * 60,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
