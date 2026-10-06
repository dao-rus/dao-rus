import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ participant: vi.fn(), reaction: vi.fn(), share: vi.fn() }));
vi.mock("../../../../lib/session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("../../../../lib/signal-reactions", () => ({ setSignalReaction: mocks.reaction,
  SignalReactionUnavailableError: class extends Error {} }));
vi.mock("../../../../lib/signals", () => ({ setSignalExternalShare: mocks.share,
  SignalValidationError: class extends Error {} }));
import { POST } from "./route";

const id = "10000000-0000-4000-8000-000000000001";
function request(action: string, extra: Record<string, string> = {}) {
  const form = new FormData(); form.set("action", action); form.set("signal_id", id);
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return new NextRequest("http://localhost:3000/api/signals/card", { method: "POST", body: form });
}

describe("Signal card member actions", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.participant.mockResolvedValue({ id: "member" }); });
  it("rejects guests without mutating reactions or share policy", async () => {
    mocks.participant.mockResolvedValue(null);
    expect((await POST(request("react_add"))).status).toBe(401);
    expect(mocks.reaction).not.toHaveBeenCalled(); expect(mocks.share).not.toHaveBeenCalled();
  });
  it("requires explicit owner confirmation before enabling an external link", async () => {
    expect((await POST(request("share_enable"))).status).toBe(400);
    expect(mocks.share).not.toHaveBeenCalled();
    const response = await POST(request("share_enable", { confirm_external_share: "yes" }));
    expect(mocks.share).toHaveBeenCalledWith("member", id, true);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`http://localhost:3000/exchange/${id}`);
  });
  it("routes idempotent reaction add/remove and share disable to the domain", async () => {
    await POST(request("react_add")); await POST(request("react_remove")); await POST(request("share_disable"));
    expect(mocks.reaction).toHaveBeenNthCalledWith(1, "member", id, true);
    expect(mocks.reaction).toHaveBeenNthCalledWith(2, "member", id, false);
    expect(mocks.share).toHaveBeenCalledWith("member", id, false);
  });
  it("rejects malformed IDs and unknown actions without a redirect", async () => {
    expect((await POST(request("react_add", { signal_id: "//evil" }))).status).toBe(404);
    expect((await POST(request("unknown"))).status).toBe(400);
    expect(mocks.reaction).not.toHaveBeenCalled(); expect(mocks.share).not.toHaveBeenCalled();
  });
  it("rejects a cross-origin form POST before reading member credentials", async () => {
    const crossOrigin = request("share_enable", { confirm_external_share: "yes" });
    crossOrigin.headers.set("origin", "https://example.invalid");
    expect((await POST(crossOrigin)).status).toBe(403);
    expect(mocks.participant).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
  });
});
