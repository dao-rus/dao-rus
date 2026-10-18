import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  publishSlovotvorWord: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/slovotvor-publication", () => ({
  publishSlovotvorWord: mocks.publishSlovotvorWord,
  SlovotvorPublicationError: class SlovotvorPublicationError extends Error {
    code: string;
    constructor(code: string) { super(code); this.code = code; }
  },
}));
vi.mock("@/lib/config", () => ({ appBaseUrl: () => "https://core.daorus.org" }));

import { POST } from "./route";

describe("POST /api/slovotvor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a guest to the task after Telegram authorization", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    const parentId = "42a8c373-486f-4ebc-bc06-24dcd2a2f8c6";
    const response = await POST(new NextRequest("https://core.daorus.org/api/slovotvor", {
      method: "POST",
      body: new URLSearchParams({ word: "промысло", source: "промпт", explanation: "", parentId }),
    }));

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/api/auth/telegram/start");
    expect(location.searchParams.get("next")).toBe(`/slovotvor?parent=${parentId}`);
    expect(mocks.publishSlovotvorWord).not.toHaveBeenCalled();
  });

  it("passes the stable task ID when an authorized user publishes a variant", async () => {
    const participant = { id: "participant-id" };
    const parentId = "42a8c373-486f-4ebc-bc06-24dcd2a2f8c6";
    mocks.getCurrentParticipant.mockResolvedValue(participant);
    mocks.publishSlovotvorWord.mockResolvedValue({
      duplicate: false,
      word: { slug: "promyslo" },
    });

    const response = await POST(new NextRequest("https://core.daorus.org/api/slovotvor", {
      method: "POST",
      body: new URLSearchParams({ word: "промысло", source: "неверное значение", explanation: "", parentId }),
    }));

    expect(mocks.publishSlovotvorWord).toHaveBeenCalledWith(
      "participant-id", "промысло", "неверное значение", "", parentId,
    );
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/slovotvor/promyslo");
  });
});
