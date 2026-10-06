import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildTelegramAuthorizationUrl: vi.fn(),
  createOidcState: vi.fn(),
  createPkce: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  isTelegramConfigured: () => true,
  secureCookies: () => true,
}));

vi.mock("@/lib/telegram-oidc", () => ({
  buildTelegramAuthorizationUrl: mocks.buildTelegramAuthorizationUrl,
  createOidcState: mocks.createOidcState,
  createPkce: mocks.createPkce,
}));

import { GET } from "./route";

describe("GET /api/auth/telegram/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores state and PKCE verifier in secure host cookies", async () => {
    mocks.createOidcState.mockReturnValue("state-for-test");
    mocks.createPkce.mockReturnValue({
      verifier: "verifier-for-test",
      challenge: "challenge-for-test",
    });
    mocks.buildTelegramAuthorizationUrl.mockReturnValue(
      new URL("https://oauth.telegram.org/auth?request=test"),
    );
    const response = await GET(new NextRequest("https://core.daorus.org/api/auth/telegram/start"));

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("dao_tg_state=state-for-test");
    expect(setCookie).toContain("dao_tg_verifier=verifier-for-test");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=600");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
  });

  it("stores only the fixed Need return path", async () => {
    mocks.createOidcState.mockReturnValue("state-for-test");
    mocks.createPkce.mockReturnValue({ verifier: "verifier", challenge: "challenge" });
    mocks.buildTelegramAuthorizationUrl.mockReturnValue(new URL("https://oauth.telegram.org/auth"));

    const need = await GET(new NextRequest("https://core.daorus.org/api/auth/telegram/start?next=%2Fneed"));
    expect(need.cookies.get("dao_tg_return_to")?.value).toBe("/need");

    const external = await GET(new NextRequest("https://core.daorus.org/api/auth/telegram/start?next=https%3A%2F%2Fevil.example"));
    expect(external.cookies.get("dao_tg_return_to")?.value).toBe("");

    const card = "/exchange/10000000-0000-4000-8000-000000000001";
    const signal = await GET(new NextRequest(`https://core.daorus.org/api/auth/telegram/start?next=${encodeURIComponent(card)}`));
    expect(signal.cookies.get("dao_tg_return_to")?.value).toBe(card);
    const traversal = await GET(new NextRequest(`https://core.daorus.org/api/auth/telegram/start?next=${encodeURIComponent(card + "/../../profile")}`));
    expect(traversal.cookies.get("dao_tg_return_to")?.value).toBe("");
  });
});
