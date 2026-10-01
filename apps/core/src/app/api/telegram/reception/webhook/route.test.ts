import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkForumAndInvite: vi.fn(),
  observeForumMemberUpdate: vi.fn(),
  relayReceptionUpdate: vi.fn(),
  diagnosticsEnabled: true,
}));

vi.mock("@/lib/config", () => ({
  telegramReceptionConfig: () => ({
    token: "test-token", webhookSecret: "test-secret",
    forumChatId: "-1001234567890", forumInviteUrl: "https://t.me/+example",
    topicId: "77", guardianInvitesEnabled: false,
    diagnosticsEnabled: mocks.diagnosticsEnabled,
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
    mocks.diagnosticsEnabled = true;
    mocks.checkForumAndInvite.mockResolvedValue(undefined);
    mocks.observeForumMemberUpdate.mockResolvedValue("observed");
    mocks.relayReceptionUpdate.mockResolvedValue("sent");
  });

  it("rejects an invalid webhook secret", async () => {
    expect((await POST(request({}, "wrong"))).status).toBe(401);
    expect(mocks.checkForumAndInvite).not.toHaveBeenCalled();
  });

  it("handles private /start from the same user", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect((await POST(request({ message: {
      chat: { id: 42, type: "private" }, from: { id: 42 }, text: "/start core",
    } }))).status).toBe(200);
    expect(mocks.checkForumAndInvite).toHaveBeenCalledWith("42", "start");
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[1]))).toMatchObject({
      update_type: "message", branch: "start", reason: "private_start_command",
    });
    log.mockRestore();
  });

  it("passes membership updates to Core and never invokes invitation from a group message", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const update = { chat_member: { chat: { id: -1001234567890 } } };
    expect((await POST(request(update))).status).toBe(200);
    expect(mocks.observeForumMemberUpdate).toHaveBeenCalledWith(update);
    expect(mocks.checkForumAndInvite).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[1]))).toMatchObject({
      update_type: "chat_member", branch: "chat_member", reason: "membership_update",
    });
    log.mockRestore();
  });

  it("routes a private message to the relay", async () => {
    const update = { update_id: 1, message: {
      chat: { id: 42, type: "private" }, from: { id: 42 }, message_id: 7, text: "Привет",
    } };
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await POST(request(update));
    expect(await response.json()).toEqual({ ok: true, status: "sent" });
    expect(mocks.relayReceptionUpdate).toHaveBeenCalledWith(update);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[1]))).toMatchObject({
      update_id: 1, update_type: "message", message_id: 7, chat_id: 42,
      chat_type: "private", has_message_thread_id: false,
      message_thread_id: null, has_text: true, branch: "private_relay",
      relay_result: "sent", copy_attempted: true,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Привет");
    expect(JSON.stringify(log.mock.calls)).not.toContain("test-secret");
    log.mockRestore();
  });

  it("logs the exact forum reply branch and ignores another topic", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const message = { update_id: 3, message: {
      message_id: 9, chat: { id: -1001234567890, type: "supergroup" },
      from: { id: 31 }, message_thread_id: 77, reply_to_message: { message_id: 8 },
      text: "Ответ",
    } };
    await POST(request(message));
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[1]))).toMatchObject({
      branch: "forum_reply", message_thread_id: 77, has_message_thread_id: true,
    });
    mocks.relayReceptionUpdate.mockResolvedValue("ignored");
    await POST(request({ ...message, update_id: 4, message: {
      ...message.message, message_thread_id: 78,
    } }));
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[1]))).toMatchObject({
      branch: "ignored", reason: "wrong_topic", relay_result: "ignored",
      copy_attempted: false,
    });
    log.mockRestore();
  });

  it("can disable diagnostic logging", async () => {
    mocks.diagnosticsEnabled = false;
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await POST(request({ update_id: 5, chat_member: {} }));
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
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
