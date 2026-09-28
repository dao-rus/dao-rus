import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelegramMiniAppInitData } from "./telegram-mini-app";

const token = "123456:TEST_BOT_TOKEN";
const now = 1_800_000_000;

function signedInitData(
  fields: Record<string, string>,
  signingToken = token,
): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => key + "=" + value)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(signingToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

describe("Telegram Mini App initData", () => {
  it("accepts Telegram's published signature vector", () => {
    const sample = "query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22Vladislav%22%2C%22last_name%22%3A%22Kibenko%22%2C%22username%22%3A%22vdkfrost%22%2C%22language_code%22%3A%22ru%22%2C%22is_premium%22%3Atrue%7D&auth_date=1662771648&hash=c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2";
    expect(verifyTelegramMiniAppInitData(
      sample,
      "5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8",
      1662771648,
    )).toMatchObject({
      telegramUserId: "279058397",
      firstName: "Vladislav",
      username: "vdkfrost",
    });
  });

  it("rejects a changed user id and a wrong bot signature", () => {
    const initData = signedInitData({
      auth_date: String(now),
      user: JSON.stringify({ id: 42, first_name: "Анна" }),
    });
    expect(() => verifyTelegramMiniAppInitData(
      initData.replace("%22id%22%3A42", "%22id%22%3A43"),
      token,
      now,
    )).toThrow("Invalid Telegram Mini App initData");
    expect(() => verifyTelegramMiniAppInitData(initData, "other-token", now))
      .toThrow("Invalid Telegram Mini App initData");
  });

  it("rejects expired or future auth_date and duplicate fields", () => {
    const stale = signedInitData({
      auth_date: String(now - 601),
      user: JSON.stringify({ id: 42, first_name: "Анна" }),
    });
    const future = signedInitData({
      auth_date: String(now + 61),
      user: JSON.stringify({ id: 42, first_name: "Анна" }),
    });
    expect(() => verifyTelegramMiniAppInitData(stale, token, now)).toThrow();
    expect(() => verifyTelegramMiniAppInitData(future, token, now)).toThrow();
    expect(() => verifyTelegramMiniAppInitData(stale + "&user=x", token, now)).toThrow();
  });

  it("uses only the verified Telegram user id", () => {
    const initData = signedInitData({
      auth_date: String(now),
      user: JSON.stringify({ id: 42, first_name: "Анна", last_name: "Русь" }),
    });
    expect(verifyTelegramMiniAppInitData(initData, token, now)).toMatchObject({
      subject: "miniapp:42",
      telegramUserId: "42",
      displayName: "Анна Русь",
      identitySource: "mini_app",
    });
  });
});
