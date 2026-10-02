import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addProfileSignal: vi.fn(),
  getCurrentParticipant: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  appBaseUrl: () => "https://core.daorus.org",
}));

vi.mock("@/lib/profile-about", () => ({
  addProfileSignal: mocks.addProfileSignal,
  ProfileAboutValidationError: class ProfileAboutValidationError extends Error {},
}));

vi.mock("@/lib/session", () => ({
  getCurrentParticipant: mocks.getCurrentParticipant,
}));

import { POST } from "./route";

function request(body: string, visibility = "members") {
  return new NextRequest("https://core.daorus.org/api/need", {
    method: "POST",
    body: new URLSearchParams({ body, visibility }),
  });
}

describe("POST /api/need", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentParticipant.mockResolvedValue({ id: "participant-id" });
  });

  it("saves a Need through the existing profile signal mechanism", async () => {
    const response = await POST(request("Нужна помощь с проектом"));
    expect(mocks.addProfileSignal).toHaveBeenCalledWith(
      "participant-id", "need", "Нужна помощь с проектом", "members",
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://core.daorus.org/need?saved=1");
  });

  it("does not save without an authenticated participant", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    const response = await POST(request("Нужна помощь"));
    expect(mocks.addProfileSignal).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://core.daorus.org/need");
  });
  it("returns the inserted reward ID for immediate feedback", async () => {
    mocks.addProfileSignal.mockResolvedValueOnce({ id: "reward-id", amount: "0.200000" });
    const response = await POST(request("Нужна помощь"));
    expect(response.headers.get("location")).toBe("https://core.daorus.org/need?saved=1&onboarding_reward=reward-id");
  });

  it("returns to the form when the existing signal validation fails", async () => {
    const { ProfileAboutValidationError } = await import("@/lib/profile-about");
    mocks.addProfileSignal.mockRejectedValue(new ProfileAboutValidationError("Invalid visibility"));
    const response = await POST(request("Нужна помощь", "invalid"));
    expect(response.headers.get("location")).toBe("https://core.daorus.org/need?error=invalid");
  });
});
