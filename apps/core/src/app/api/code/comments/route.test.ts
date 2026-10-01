import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  participant: vi.fn(), change: vi.fn(), admin: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("@/lib/config", () => ({
  appBaseUrl: () => "http://localhost:3000", hasPrototypeAdminAccess: mocks.admin,
}));
vi.mock("../../../../lib/code-comments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/code-comments")>();
  return { ...actual, changeCodeComment: mocks.change };
});

import { POST } from "./route";

function request(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new NextRequest("http://localhost:3000/api/code/comments", { method: "POST", body: form });
}

describe("code comments route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockReturnValue(false); });

  it("denies anonymous writes before reading the form", async () => {
    mocks.participant.mockResolvedValue(null);
    const response = await POST(request({ action: "create", section: "dao-code-1", body: "Текст" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
    expect(mocks.change).not.toHaveBeenCalled();
  });

  it("takes actor and admin status from server session and redirects to the section", async () => {
    mocks.participant.mockResolvedValue({ id: "actor" });
    mocks.admin.mockReturnValue(true);
    const response = await POST(request({ action: "hide", section: "dao-code-2", comment_id: "30000000-0000-4000-8000-000000000003", reason: "Причина" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/code?section=dao-code-2#dao-code-2");
    expect(mocks.change).toHaveBeenCalledWith("actor", true, expect.objectContaining({
      action: "hide", section: "dao-code-2", reason: "Причина",
    }));
  });

  it("rejects unregistered sections before calling the database", async () => {
    mocks.participant.mockResolvedValue({ id: "actor" });
    const response = await POST(request({ action: "create", section: "other", body: "Текст" }));
    expect(response.status).toBe(400);
    expect(mocks.change).not.toHaveBeenCalled();
  });
});
