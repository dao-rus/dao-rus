import { describe, expect, it } from "vitest";
import { TelegramAvatar } from "./telegram-avatar";

const props = {
  participantId: "10000000-0000-4000-8000-000000000001",
  displayName: "Анна",
  avatarUrl: "https://cdn.example/anna.jpg",
  hasTelegramPhoto: false,
};

describe("TelegramAvatar", () => {
  it("uses the server photo route for a stored Bot API file reference", () => {
    expect(TelegramAvatar({ ...props, hasTelegramPhoto: true })?.props.src)
      .toBe(`/api/telegram/profile-photo/${props.participantId}`);
  });

  it("falls back to a provided OIDC picture without inventing a photo", () => {
    expect(TelegramAvatar(props)?.props.src).toBe(props.avatarUrl);
    expect(TelegramAvatar({ ...props, avatarUrl: null })).toBeNull();
  });
});
