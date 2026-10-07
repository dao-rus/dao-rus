import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ participant: vi.fn(), reaction: vi.fn(), view: vi.fn(), hide: vi.fn(),
  forumDeps: vi.fn(), open: vi.fn(), notify: vi.fn() }));
vi.mock("../../../../lib/guardian-forum-actions", () => ({ forumDeps: mocks.forumDeps }));
vi.mock("../../../../lib/signal-discussion", () => ({ openDiscussion: mocks.open }));
vi.mock("../../../../lib/notifications", () => ({ createNotification: mocks.notify }));
vi.mock("../../../../lib/session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("../../../../lib/signal-reactions", () => ({ setSignalReaction: mocks.reaction,
  SignalReactionUnavailableError: class extends Error {} }));
vi.mock("../../../../lib/signals", () => ({ SignalValidationError: class extends Error {},
  countSignalView: mocks.view, setSignalHidden: mocks.hide }));
import { POST } from "./route";

const id = "10000000-0000-4000-8000-000000000001";
function request(action: string, extra: Record<string, string> = {}) {
  const form = new FormData(); form.set("action", action); form.set("signal_id", id);
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return new NextRequest("http://localhost:3000/api/signals/card", { method: "POST", body: form });
}

describe("Signal card member actions", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.participant.mockResolvedValue({ id: "member" }); });
  it("rejects guests without mutating reactions", async () => {
    mocks.participant.mockResolvedValue(null);
    expect((await POST(request("react_add"))).status).toBe(401);
    expect(mocks.reaction).not.toHaveBeenCalled();
  });
  it("routes idempotent like add/remove to the domain and redirects to the card", async () => {
    const response = await POST(request("react_add"));
    await POST(request("react_remove"));
    expect(mocks.reaction).toHaveBeenNthCalledWith(1, "member", id, true);
    expect(mocks.reaction).toHaveBeenNthCalledWith(2, "member", id, false);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`http://localhost:3000/exchange/${id}`);
  });
  it("counts a view for members and guests alike and never reveals whether the record exists", async () => {
    expect((await POST(request("view"))).status).toBe(204);
    expect(mocks.view).toHaveBeenLastCalledWith("member", id);
    mocks.participant.mockResolvedValue(null);
    const guest = await POST(request("view", { signal_id: "//evil" }));
    expect(guest.status).toBe(204);
    expect(mocks.view).toHaveBeenLastCalledWith(null, "//evil");
    expect(guest.headers.get("location")).toBeNull();
  });
  it("hides a record for the session participant only and returns to its tab; unhide returns to the hidden list", async () => {
    mocks.hide.mockResolvedValue({ id, typeKey: "have" });
    const hidden = await POST(request("hide"));
    expect(mocks.hide).toHaveBeenLastCalledWith("member", id, true);
    expect(hidden.headers.get("location")).toBe("http://localhost:3000/exchange?type=have");
    const shown = await POST(request("unhide"));
    expect(mocks.hide).toHaveBeenLastCalledWith("member", id, false);
    expect(shown.headers.get("location")).toBe("http://localhost:3000/exchange?hidden=1");
    mocks.hide.mockResolvedValue(null);
    expect((await POST(request("hide"))).status).toBe(404);
    mocks.participant.mockResolvedValue(null);
    expect((await POST(request("hide"))).status).toBe(401);
  });
  it("opens a forum discussion for the session participant and tells the author once, without the record's text", async () => {
    const deps = { texts: { "forum.notify_discussion": "Вашу запись обсуждают в форуме.", "forum.discussion_open": "Открыть запись" } };
    mocks.forumDeps.mockResolvedValue(deps); mocks.notify.mockResolvedValue("n");
    mocks.open.mockResolvedValue({ status: "open", link: "https://t.me/c/1/2/3", created: true, authorId: "author" });
    const first = await POST(request("discuss"));
    expect(mocks.open).toHaveBeenCalledWith(deps, "member", id);
    expect(first.headers.get("location")).toBe("https://t.me/c/1/2/3");
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify.mock.calls[0][0]).toEqual({ participantId: "author", notificationType: "exchange.discussion_opened", sourceType: "system",
      text: "Вашу запись обсуждают в форуме.", actionUrl: `/exchange/${id}`, actionLabel: "Открыть запись", queueTelegram: true });
    mocks.open.mockResolvedValue({ status: "open", link: "https://t.me/c/1/2/3", created: false, authorId: null });
    await POST(request("discuss"));
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });
  it("answers a discussion that cannot be opened without revealing why, and survives a Telegram failure", async () => {
    mocks.forumDeps.mockResolvedValue({ texts: {} });
    mocks.open.mockResolvedValue({ status: "unavailable" });
    expect((await POST(request("discuss"))).status).toBe(404);
    mocks.forumDeps.mockResolvedValue(null);
    expect((await POST(request("discuss"))).status).toBe(404);
    mocks.forumDeps.mockResolvedValue({ texts: {} });
    mocks.open.mockResolvedValue({ status: "pending" });
    expect((await POST(request("discuss"))).headers.get("location")).toBe(`http://localhost:3000/exchange/${id}?discussion=pending`);
    mocks.open.mockRejectedValue(new Error("Telegram down"));
    expect((await POST(request("discuss"))).headers.get("location")).toBe(`http://localhost:3000/exchange/${id}?discussion=failed`);
    mocks.participant.mockResolvedValue(null);
    expect((await POST(request("discuss"))).status).toBe(401);
  });
  it("no longer accepts external-share policy actions", async () => {
    expect((await POST(request("share_enable", { confirm_external_share: "yes" }))).status).toBe(400);
    expect((await POST(request("share_disable"))).status).toBe(400);
    expect(mocks.reaction).not.toHaveBeenCalled();
  });
  it("rejects malformed IDs and unknown actions without a redirect", async () => {
    expect((await POST(request("react_add", { signal_id: "//evil" }))).status).toBe(404);
    expect((await POST(request("unknown"))).status).toBe(400);
    expect(mocks.reaction).not.toHaveBeenCalled();
  });
  it("rejects a cross-origin form POST before reading member credentials", async () => {
    const crossOrigin = request("react_add");
    crossOrigin.headers.set("origin", "https://example.invalid");
    expect((await POST(crossOrigin)).status).toBe(403);
    expect(mocks.participant).not.toHaveBeenCalled();
    expect(mocks.reaction).not.toHaveBeenCalled();
  });
});
