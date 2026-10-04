import { afterEach, describe, expect, it, vi } from "vitest";
import { telegramBotToken, telegramNotificationsEnabled } from "./config";

afterEach(() => vi.unstubAllEnvs());

describe("Telegram Bot API token configuration", () => {
  it("accepts only the token of the OIDC bot", () => {
    vi.stubEnv("TELEGRAM_OIDC_CLIENT_ID", "123");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "456:other-bot-secret");
    expect(telegramBotToken()).toBeUndefined();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123:matching-secret");
    expect(telegramBotToken()).toBe("123:matching-secret");
  });
  it("keeps notification delivery disabled unless explicitly enabled", () => {
    vi.stubEnv("TELEGRAM_NOTIFICATIONS_ENABLED", "");
    expect(telegramNotificationsEnabled()).toBe(false);
    vi.stubEnv("TELEGRAM_NOTIFICATIONS_ENABLED", "false");
    expect(telegramNotificationsEnabled()).toBe(false);
    vi.stubEnv("TELEGRAM_NOTIFICATIONS_ENABLED", "true");
    expect(telegramNotificationsEnabled()).toBe(true);
  });
});
