import { NextRequest, NextResponse } from "next/server";
import { isTelegramConfigured, secureCookies } from "@/lib/config";
import {
  buildTelegramAuthorizationUrl,
  createOidcState,
  createPkce,
} from "@/lib/telegram-oidc";

export const runtime = "nodejs";

const FLOW_TTL_SECONDS = 600;

export async function GET(request: NextRequest) {
  if (!isTelegramConfigured()) {
    return new NextResponse("Telegram OIDC is not configured", { status: 503 });
  }

  const state = createOidcState();
  const { verifier, challenge } = createPkce();
  const authUrl = buildTelegramAuthorizationUrl(state, challenge);
  const response = NextResponse.redirect(authUrl);
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureCookies(),
    path: "/",
    maxAge: FLOW_TTL_SECONDS,
  };

  response.cookies.set("dao_tg_state", state, options);
  response.cookies.set("dao_tg_verifier", verifier, options);
  const returnTo = request.nextUrl.searchParams.get("next") === "/need" ? "/need" : "";
  response.cookies.set("dao_tg_return_to", returnTo, {
    ...options,
    maxAge: returnTo ? FLOW_TTL_SECONDS : 0,
  });
  return response;
}
