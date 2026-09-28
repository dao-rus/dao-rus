import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  telegramBotToken: () => "123456:TEST_BOT_TOKEN",
  secureCookies: () => true,
  sessionTtlDays: () => 30,
}));
vi.mock("@/lib/identity", () => ({
  resolveTelegramParticipant: mocks.resolve,
}));
vi.mock("@/lib/postgres-identity-store", () => ({
  PostgresIdentityStore: class {},
}));
vi.mock("@/lib/session", () => ({
  createSession: mocks.createSession,
  SESSION_COOKIE: "dao_session",
}));

import { POST } from "./route";

const token = "123456:TEST_BOT_TOKEN";
const now = 1_800_000_000;

function signedInitData(authDate = now): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id: 42, first_name: "Анна" }),
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => key + "=" + value)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return params.toString();
}

function request(initData: string): NextRequest {
  return new NextRequest("https://core.example/api/auth/telegram/mini-app", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initData }),
  });
}

describe("POST /api/auth/telegram/mini-app", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    mocks.createSession.mockResolvedValue("core-session-token");
  });

  it.each([false, true])(
    "resolves a verified Telegram user through Core (created=%s) and returns a session for /need",
    async (created) => {
      mocks.resolve.mockResolvedValue({
        participant: { id: created ? "new-participant" : "existing-participant" },
        created,
      });

      const response = await POST(request(signedInitData()));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, returnTo: "/need" });
      expect(mocks.resolve).toHaveBeenCalledOnce();
      expect(mocks.resolve.mock.calls[0][1]).toMatchObject({
        telegramUserId: "42",
        subject: "miniapp:42",
        identitySource: "mini_app",
      });
      expect(mocks.createSession).toHaveBeenCalledWith(
        created ? "new-participant" : "existing-participant",
      );
      expect(response.cookies.get("dao_session")?.value).toBe("core-session-token");
      expect(response.headers.get("set-cookie")).toContain("HttpOnly");
      expect(response.headers.get("set-cookie")).toContain("Secure");
    },
  );

  it("rejects an altered signature before identity lookup or session creation", async () => {
    const changed = signedInitData().replace("%22id%22%3A42", "%22id%22%3A43");
    const response = await POST(request(changed));
    expect(response.status).toBe(401);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("rejects expired auth_date before identity lookup or session creation", async () => {
    const response = await POST(request(signedInitData(now - 601)));
    expect(response.status).toBe(401);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});
