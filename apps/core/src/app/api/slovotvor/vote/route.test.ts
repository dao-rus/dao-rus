import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  getSlovotvorWordById: vi.fn(),
  castSlovotvorVote: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/config", () => ({ appBaseUrl: () => "https://core.daorus.org" }));
vi.mock("@/lib/slovotvor", () => ({
  getSlovotvorWordById: mocks.getSlovotvorWordById,
  castSlovotvorVote: mocks.castSlovotvorVote,
  SlovotvorVoteError: class SlovotvorVoteError extends Error {},
}));

import { POST } from "./route";

describe("POST /api/slovotvor/vote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSlovotvorWordById.mockResolvedValue({ id: "word-id", slug: "kraynesrok", word: "крайнесрок" });
  });

  it("sends an unauthenticated voter to Telegram login with the card return path", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    const response = await POST(new NextRequest("https://core.daorus.org/api/slovotvor/vote", {
      method: "POST",
      body: new URLSearchParams({ wordId: "word-id", choice: "better" }),
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/api/auth/telegram/start?next=%2Fslovotvor%2Fkraynesrok");
    expect(mocks.castSlovotvorVote).not.toHaveBeenCalled();
  });

  it("casts an authenticated vote and returns to the card", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "participant-id" });
    const response = await POST(new NextRequest("https://core.daorus.org/api/slovotvor/vote", {
      method: "POST",
      body: new URLSearchParams({ wordId: "word-id", choice: "worse" }),
    }));
    expect(mocks.castSlovotvorVote).toHaveBeenCalledWith("word-id", "participant-id", "worse");
    expect(response.headers.get("location")).toBe("https://core.daorus.org/slovotvor/kraynesrok");
  });
});
