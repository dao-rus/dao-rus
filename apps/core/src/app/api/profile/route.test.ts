import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  saveProfile: vi.fn(),
  updateParticipantDisplayName: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  appBaseUrl: () => "http://localhost:3000",
}));

vi.mock("@/lib/session", () => ({
  getCurrentParticipant: mocks.getCurrentParticipant,
}));

vi.mock("@/lib/profile", () => ({
  DisplayNameValidationError: class DisplayNameValidationError extends Error {},
  updateParticipantDisplayName: mocks.updateParticipantDisplayName,
}));

vi.mock("@/lib/profile-about", () => ({
  ProfileAboutValidationError: class ProfileAboutValidationError extends Error {},
  saveProfile: mocks.saveProfile,
}));

import { POST } from "./route";

function profileRequest(fields: Record<string, string>) {
  return new Request("http://localhost:3000/api/profile", {
    method: "POST",
    body: new URLSearchParams(fields),
  }) as Parameters<typeof POST>[0];
}

describe("POST /api/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves name and bio only for the participant from the current session", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "current-participant" });
    mocks.saveProfile.mockResolvedValue({ changed: true });

    const response = await POST(
      profileRequest({
        display_name: "Новое имя",
        bio: "О себе",
        visibility: "members",
        participant_id: "another-participant",
      }),
    );

    expect(mocks.saveProfile).toHaveBeenCalledWith(
      "current-participant",
      "Новое имя",
      "О себе",
      "members",
      undefined,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profile?profile_update=updated",
    );
  });

  it("does not update a profile without an authenticated participant", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);

    const response = await POST(profileRequest({ display_name: "Новое имя" }));

    expect(mocks.saveProfile).not.toHaveBeenCalled();
    expect(mocks.updateParticipantDisplayName).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  it("keeps existing name-only submissions working", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "current-participant" });
    mocks.updateParticipantDisplayName.mockResolvedValue({ changed: true });

    const response = await POST(profileRequest({ display_name: "Новое имя" }));

    expect(mocks.updateParticipantDisplayName).toHaveBeenCalledWith("current-participant", "Новое имя");
    expect(mocks.saveProfile).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost:3000/profile?profile_update=updated");
  });

  it("passes all three optional residence fields from the authenticated form", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "current-participant" });
    mocks.saveProfile.mockResolvedValue({ changed: true });

    await POST(profileRequest({ display_name: "Анна", bio: "", visibility: "members",
      residence_name: "Казань", residence_type: "город", residence_country: "Россия",
    }));

    expect(mocks.saveProfile).toHaveBeenCalledWith("current-participant", "Анна", "", "members", {
      name: "Казань", type: "город", country: "Россия",
    });
  });

  it("accepts a profile form with no bio or residence", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "current-participant" });
    mocks.saveProfile.mockResolvedValue({ changed: false });

    const response = await POST(profileRequest({ display_name: "Анна", bio: "", visibility: "members",
      residence_name: "", residence_type: "", residence_country: "",
    }));

    expect(mocks.saveProfile).toHaveBeenCalledWith("current-participant", "Анна", "", "members", {
      name: "", type: "", country: "",
    });
    expect(response.headers.get("location")).toBe("http://localhost:3000/profile?profile_update=unchanged");
  });
});
