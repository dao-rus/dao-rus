import { NextResponse } from "next/server";
import { telegramReceptionConfig } from "../../../../lib/config";
import { TelegramMiniAppAuthError, verifyTelegramMiniAppInitData } from "../../../../lib/telegram-mini-app";
import { ReceptionApplicationError, getReceptionApplication, saveReceptionApplication } from "../../../../lib/reception-applications";
import { pool } from "../../../../lib/db";

export const runtime = "nodejs";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Vary": "Authorization" } });
}

async function handle(request: Request, write = false, updateOnly = false) {
  const token = telegramReceptionConfig().token;
  if (!token) return response({ error: "reception_unavailable" }, 503);
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("tma ")) return response({ error: "unauthorized" }, 401);
  let telegramUserId: string;
  let profile;
  try {
    profile = verifyTelegramMiniAppInitData(authorization.slice(4), token);
    telegramUserId = profile.telegramUserId;
  } catch (error) {
    if (error instanceof TelegramMiniAppAuthError) return response({ error: "unauthorized" }, 401);
    throw error;
  }
  // No application ID or Telegram ID selector: every operation targets the verified caller.
  if (new URL(request.url).search) return response({ error: "invalid_request" }, 400);
  try {
    if (!write) return response({ application: await getReceptionApplication(telegramUserId) });
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      return response({ error: "invalid_form" }, 400);
    }
    const raw = await request.text();
    if (raw.length > 8_000) return response({ error: "invalid_form" }, 400);
    let input: unknown;
    try { input = JSON.parse(raw); } catch { return response({ error: "invalid_form" }, 400); }
    const { application, created } = await saveReceptionApplication(telegramUserId, input, updateOnly, pool, profile);
    return response({ application }, created ? 201 : 200);
  } catch (error) {
    if (error instanceof ReceptionApplicationError) {
      const status = { invalid_form: 400, not_found: 404, rate_limit: 429, identity_conflict: 409 }[error.code];
      const result = response({ error: error.code }, status);
      if (status === 429) result.headers.set("Retry-After", "60");
      return result;
    }
    // Do not expose or log request bodies, initData, tokens, SQL parameters or personal data.
    return response({ error: "reception_unavailable" }, 503);
  }
}

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request, true); }
export async function PUT(request: Request) { return handle(request, true, true); }
