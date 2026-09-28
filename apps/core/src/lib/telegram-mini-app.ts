import { createHmac, timingSafeEqual } from "node:crypto";
import type { TelegramIdentityProfile } from "./identity";

const MAX_INIT_DATA_LENGTH = 16_384;
const INIT_DATA_TTL_SECONDS = 600;
const FUTURE_SKEW_SECONDS = 60;

export class TelegramMiniAppAuthError extends Error {
  constructor() {
    super("Invalid Telegram Mini App initData");
    this.name = "TelegramMiniAppAuthError";
  }
}

export function verifyTelegramMiniAppInitData(
  initData: string,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): TelegramIdentityProfile {
  if (!initData || initData.length > MAX_INIT_DATA_LENGTH) {
    throw new TelegramMiniAppAuthError();
  }

  const params = new URLSearchParams(initData);
  const fields = new Map<string, string>();
  for (const [key, value] of params) {
    if (fields.has(key)) throw new TelegramMiniAppAuthError();
    fields.set(key, value);
  }

  const hash = fields.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    throw new TelegramMiniAppAuthError();
  }
  fields.delete("hash");

  const dataCheckString = [...fields.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => key + "=" + value)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest();
  const actual = Buffer.from(hash, "hex");
  if (!timingSafeEqual(actual, expected)) {
    throw new TelegramMiniAppAuthError();
  }

  const authDate = Number(fields.get("auth_date"));
  if (!Number.isSafeInteger(authDate)
      || authDate > nowSeconds + FUTURE_SKEW_SECONDS
      || nowSeconds - authDate > INIT_DATA_TTL_SECONDS) {
    throw new TelegramMiniAppAuthError();
  }

  let user: unknown;
  try {
    user = JSON.parse(fields.get("user") ?? "");
  } catch {
    throw new TelegramMiniAppAuthError();
  }
  if (!user || typeof user !== "object") throw new TelegramMiniAppAuthError();
  const telegramUser = user as Record<string, unknown>;
  const id = telegramUser.id;
  const firstName = telegramUser.first_name;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0
      || typeof firstName !== "string" || !firstName.trim()) {
    throw new TelegramMiniAppAuthError();
  }

  const lastName = typeof telegramUser.last_name === "string"
    ? telegramUser.last_name : null;
  const username = typeof telegramUser.username === "string"
    ? telegramUser.username : null;
  return {
    subject: "miniapp:" + id,
    telegramUserId: String(id),
    username,
    firstName,
    lastName,
    displayName: [firstName, lastName].filter(Boolean).join(" "),
    avatarUrl: null,
    identitySource: "mini_app",
  };
}
