import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  query: vi.fn(),
  downloadTelegramProfilePhoto: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/db", () => ({ pool: { query: mocks.query } }));
vi.mock("@/lib/telegram-bot-profile", () => ({ downloadTelegramProfilePhoto: mocks.downloadTelegramProfilePhoto }));

import { GET } from "./route";

const participantId = "10000000-0000-4000-8000-000000000001";
const context = (id: string) => ({ params: Promise.resolve({ participantId: id }) });

describe("profile photo route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
  });

  it("requires a Core session and rejects invalid IDs", async () => {
    mocks.getCurrentParticipant.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://core.example/photo"), context(participantId))).status).toBe(401);
    expect((await GET(new Request("https://core.example/photo"), context("file-id"))).status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("looks up only the stored current photo of a logged-in Core Participant", async () => {
    mocks.query.mockResolvedValue({ rows: [{ file_id: "stored-photo" }] });
    mocks.downloadTelegramProfilePhoto.mockResolvedValue({
      body: new Uint8Array([1, 2, 3]).buffer,
      contentType: "image/jpeg",
    });
    const response = await GET(new Request("https://core.example/photo?file_id=attacker"), context(participantId));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(mocks.query.mock.calls[0][0]).toContain("login.event_type = 'participant.logged_in'");
    expect(mocks.query.mock.calls[0][1]).toEqual([participantId]);
    expect(mocks.downloadTelegramProfilePhoto).toHaveBeenCalledWith("stored-photo");
    expect(response.headers.toString()).not.toContain("private-token");
  });

  it("does not fetch photos for an unknown or pre-login Participant", async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    expect((await GET(new Request("https://core.example/photo"), context(participantId))).status).toBe(404);
    expect(mocks.downloadTelegramProfilePhoto).not.toHaveBeenCalled();
  });

  it("falls back to the saved OIDC picture when Bot API photo fails", async () => {
    mocks.query.mockResolvedValue({ rows: [{ file_id: "stored-photo", oidc_picture: "https://cdn.example/avatar.jpg" }] });
    mocks.downloadTelegramProfilePhoto.mockResolvedValue(null);
    const response = await GET(new Request("https://core.example/photo"), context(participantId));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://cdn.example/avatar.jpg");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.downloadTelegramProfilePhoto).toHaveBeenCalledWith("stored-photo");
  });

  it("uses the OIDC picture when Telegram reports no Bot API photo", async () => {
    mocks.query.mockResolvedValue({ rows: [{ file_id: "old-photo", photo_count: "0", oidc_picture: "https://cdn.example/avatar.jpg" }] });
    const response = await GET(new Request("https://core.example/photo"), context(participantId));
    expect(response.status).toBe(307);
    expect(mocks.downloadTelegramProfilePhoto).not.toHaveBeenCalled();
  });

  it("does not redirect to an unsafe fallback URL", async () => {
    mocks.query.mockResolvedValue({ rows: [{ file_id: "stored-photo", oidc_picture: "https://api.telegram.org/file/botsecret/avatar.jpg" }] });
    mocks.downloadTelegramProfilePhoto.mockResolvedValue(null);
    const response = await GET(new Request("https://core.example/photo"), context(participantId));
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
  });
});
