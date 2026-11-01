import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkForumAndInvite: vi.fn(),
  observeForumMemberUpdate: vi.fn(),
  observeHubMessage: vi.fn(),
  observeHubReaction: vi.fn(),
  relayReceptionUpdate: vi.fn(),
  start: vi.fn(), relayed: vi.fn(), joined: vi.fn(), announce: vi.fn(),
}));
vi.mock("../../../../../lib/reception-voice", () => ({ onReceptionStart: mocks.start, onReceptionRelayed: mocks.relayed, onForumMemberUpdate: mocks.joined }));
vi.mock("../../../../../lib/guardian-forum-actions", () => ({ afterForumMemberUpdate: mocks.announce }));

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
vi.mock("@/lib/telegram-hub-reactions", () => ({
  observeHubMessage: mocks.observeHubMessage,
  observeHubReaction: mocks.observeHubReaction,
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

  it("acknowledges every authenticated update, so one refused update can never stall the forum's replies", async () => {
    // A long forum post arrives escaped: 4096 Cyrillic letters are about 25 KB. It used to be answered with 400.
    const longPost = { update_id: 10, message: { chat: { id: -1001234567890, type: "supergroup" }, from: { id: 7 }, message_id: 1,
      text: "я".repeat(4096), reply_to_message: { message_id: 2, text: "ж".repeat(4096) } } };
    const escaped = JSON.stringify(longPost).replace(/[\u0400-\u04ff]/g, (char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"));
    expect(escaped.length).toBeGreaterThan(40_000);
    const raw = (body: string) => POST(new NextRequest("http://localhost/api/telegram/reception/webhook", {
      method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret" }, body }));
    const long = await raw(escaped);
    expect(long.status).toBe(200);
    expect(mocks.relayReceptionUpdate).toHaveBeenCalledTimes(1);
    for (const body of ["not json", "[]", "null", "x".repeat(600_000)]) {
      const response = await raw(body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, status: "ignored" });
    }
    expect(mocks.relayReceptionUpdate).toHaveBeenCalledTimes(1);
    // Only a wrong secret is refused.
    expect((await POST(request(longPost, "wrong"))).status).toBe(401);
  });

  it("gives the bot a voice only where a person is waiting for one", async () => {
    const start = (text: string) => POST(request({ message: { chat: { id: 42, type: "private" }, from: { id: 42 }, text } }));
    await start("/start");
    expect(mocks.start).toHaveBeenCalledWith("42");
    mocks.start.mockClear();
    await start("/start core");
    expect(mocks.start).not.toHaveBeenCalled();
    // An introduction relayed from a private chat is acknowledged; a member's reply relayed back is not.
    await POST(request({ update_id: 5, message: { chat: { id: 42, type: "private" }, from: { id: 42 }, message_id: 7, text: "О себе" } }));
    expect(mocks.relayed).toHaveBeenCalledWith("42", "О себе", 5);
    mocks.relayed.mockClear();
    await POST(request({ update_id: 6, message: { chat: { id: -1001234567890, type: "supergroup" }, from: { id: 7 }, message_id: 9, text: "Ответ" } }));
    mocks.relayReceptionUpdate.mockResolvedValue("failed");
    await POST(request({ update_id: 7, message: { chat: { id: 42, type: "private" }, from: { id: 42 }, message_id: 8, text: "Ещё" } }));
    expect(mocks.relayed).not.toHaveBeenCalled();
    // Membership updates reach the welcome and the newcomer announcement only when Core observed them.
    const update = { chat_member: { chat: { id: -1001234567890 } } };
    await POST(request(update));
    expect(mocks.joined).toHaveBeenCalledWith(update);
    expect(mocks.announce).toHaveBeenCalledWith(update);
    mocks.joined.mockClear(); mocks.announce.mockClear();
    mocks.observeForumMemberUpdate.mockResolvedValue("ignored");
    await POST(request(update));
    expect(mocks.joined).not.toHaveBeenCalled();
    expect(mocks.announce).not.toHaveBeenCalled();
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
