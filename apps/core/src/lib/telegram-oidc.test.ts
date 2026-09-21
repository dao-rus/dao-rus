import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({
  telegramConfig: () => ({ clientId: "123", redirectUri: "https://core.example/callback" }),
}));

import { buildTelegramAuthorizationUrl, telegramProfileFromClaims } from "./telegram-oidc";

describe("Telegram OIDC profile", () => {
  it("requests profile, consented phone and bot access", () => {
    const url = buildTelegramAuthorizationUrl("state", "challenge");
    expect(url.searchParams.get("scope")).toBe("openid profile phone telegram:bot_access");
  });

  it("keeps all provided user-authored claims and their OIDC provenance", () => {
    const profile = telegramProfileFromClaims({
      sub: "subject", id: 42, name: "Анна", given_name: "Анна", family_name: "Русь",
      preferred_username: "anna", picture: "https://cdn.example/anna.jpg",
      phone_number: "+79990000000", phone_number_verified: true,
    });
    expect(profile).toMatchObject({
      subject: "subject", telegramUserId: "42", displayName: "Анна",
      username: "anna", firstName: "Анна", lastName: "Русь",
      avatarUrl: "https://cdn.example/anna.jpg",
      oidcProfile: {
        id: "42", name: "Анна", given_name: "Анна", family_name: "Русь",
        preferred_username: "anna", picture: "https://cdn.example/anna.jpg",
        phone_number: "+79990000000", phone_number_verified: true,
      },
    });
  });

  it("accepts missing optional claims without inventing a phone or avatar", () => {
    const profile = telegramProfileFromClaims({ sub: "subject" });
    expect(profile.telegramUserId).toBe("subject");
    expect(profile.username).toBeNull();
    expect(profile.avatarUrl).toBeNull();
    expect(profile.oidcProfile).toEqual({});
  });
});
