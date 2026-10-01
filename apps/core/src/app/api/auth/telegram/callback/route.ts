import { NextRequest, NextResponse } from "next/server";
import { PostgresIdentityStore } from "@/lib/postgres-identity-store";
import { resolveTelegramParticipant } from "@/lib/identity";
import { authenticateTelegramCode } from "@/lib/telegram-oidc";
import { enrichTelegramProfile } from "@/lib/telegram-bot-profile";
import { checkForumAndInvite } from "@/lib/telegram-forum-onboarding";
import { createSession, SESSION_COOKIE } from "@/lib/session";
import {
  appBaseUrl,
  secureCookies,
  sessionTtlDays,
} from "@/lib/config";

export const runtime = "nodejs";

function clearFlowCookies(response: NextResponse) {
  for (const name of ["dao_tg_state", "dao_tg_verifier", "dao_tg_return_to"]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies(),
      path: "/",
      maxAge: 0,
    });
  }
}

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    const response = NextResponse.redirect(
      new URL(`/?auth_error=${encodeURIComponent(error)}`, appBaseUrl()),
      303
    );

    clearFlowCookies(response);
    return response;
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get("dao_tg_state")?.value;
  const verifier = request.cookies.get("dao_tg_verifier")?.value;
  const stateMatches = Boolean(state && expectedState && state === expectedState);

  if (!code || !state || !expectedState || !verifier || !stateMatches) {
    const response = new NextResponse("Invalid or expired Telegram login flow", {
      status: 400,
    });
    clearFlowCookies(response);
    return response;
  }

  try {
    const profile = await authenticateTelegramCode(code, verifier);
    // Bot API data is optional; its failure must never invalidate a verified OIDC login.
    profile.botProfile = await enrichTelegramProfile(profile.telegramUserId).catch(() => ({}));

    const store = new PostgresIdentityStore();
    const { participant } = await resolveTelegramParticipant(store, profile);

    const sessionToken = await createSession(participant.id);
    // Forum onboarding is optional and must not affect a verified Core login.
    await checkForumAndInvite(profile.telegramUserId, "login").catch(() => undefined);

    const returnTo = request.cookies.get("dao_tg_return_to")?.value === "/need"
      ? "/need" : "/profile";
    const response = NextResponse.redirect(
      new URL(returnTo, appBaseUrl()),
      303
    );

    response.cookies.set(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookies(),
      path: "/",
      maxAge: sessionTtlDays() * 24 * 60 * 60,
    });

    clearFlowCookies(response);
    return response;
  } catch (authError) {
    console.error("Telegram authentication failed", authError);

    const response = NextResponse.redirect(
      new URL("/?auth_error=telegram_failed", appBaseUrl()),
      303
    );

    clearFlowCookies(response);
    return response;
  }
}
