import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkForumAndInvite: vi.fn(),
  observeForumMemberUpdate: vi.fn(),
  relayReceptionUpdate: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  telegramReceptionConfig: () => ({
    token: "test-token", webhookSecret: "test-secret",
    forumChatId: "-1001234567890", forumInviteUrl: "https://t.me/+example",
    topicId: "77", guardianInvitesEnabled: false,
  }),
}));
vi.mock("@/lib/telegram-forum-onboarding", () => ({
  checkForumAndInvite: mocks.checkForumAndInvite,
  observeForumMemberUpdate: mocks.observeForumMemberUpdate,
}));
vi.mock("@/lib/telegram-reception-relay", () => ({ relayReceptionUpdate: mocks.relayReceptionUpdate }));

import { POST } from "./route";

function request(body: unknown, secret = "test-secret") {
  return new NextRequest("http://localhost/api/telegram/reception/webhook", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": secret },
    body: JSON.stringify(body),
  });
}

describe("Reception webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkForumAndInvite.mockResolvedValue(undefined);
    mocks.observeForumMemberUpdate.mockResolvedValue("observed");
    mocks.relayReceptionUpdate.mockResolvedValue("sent");
  });

  it("rejects an invalid webhook secret", async () => {
    expect((await POST(request({}, "wrong"))).status).toBe(401);
    expect(mocks.checkForumAndInvite).not.toHaveBeenCalled();
  });

  it("handles private /start from the same user", async () => {
    expect((await POST(request({ message: {
      chat: { id: 42, type: "private" }, from: { id: 42 }, text: "/start core",
    } }))).status).toBe(200);
    expect(mocks.checkForumAndInvite).toHaveBeenCalledWith("42", "start");
  });

  it("passes membership updates to Core and never invokes invitation from a group message", async () => {
    const update = { chat_member: { chat: { id: -1001234567890 } } };
    expect((await POST(request(update))).status).toBe(200);
    expect(mocks.observeForumMemberUpdate).toHaveBeenCalledWith(update);
    expect(mocks.checkForumAndInvite).not.toHaveBeenCalled();
  });

  it("routes a private message to the relay", async () => {
    const update = { update_id: 1, message: {
      chat: { id: 42, type: "private" }, from: { id: 42 }, message_id: 7, text: "Привет",
    } };
    const response = await POST(request(update));
    expect(await response.json()).toEqual({ ok: true, status: "sent" });
    expect(mocks.relayReceptionUpdate).toHaveBeenCalledWith(update);
    expect(mocks.observeForumMemberUpdate).not.toHaveBeenCalled();
  });

  it("acknowledges an unsupported message without a webhook error", async () => {
    mocks.relayReceptionUpdate.mockResolvedValue("unsupported");
    const response = await POST(request({ update_id: 2, message: {
      chat: { id: 42, type: "private" }, from: { id: 42 },
      message_id: 8, dice: { emoji: "🎲" },
    } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: "unsupported" });
  });
});
