import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  receptionRelayBot,
  relayReceptionUpdate,
  type ReceptionRelayBot,
  type ReceptionRelayDatabase,
} from "./telegram-reception-relay";

const receptionConfig = vi.hoisted(() => ({ topicId: "77" }));

vi.mock("./config", () => ({
  telegramReceptionConfig: () => ({
    token: "123456:test-token", forumChatId: "-1001234567890", topicId: receptionConfig.topicId,
  }),
}));

type RelayRow = {
  updateId: number;
  direction: string;
  forumChatId: string;
  privateChatId: string;
  privateMessageId: number | null;
  forumMessageId: number | null;
  status: string;
  errorCode?: string;
};

function fakeDatabase() {
  const rows = new Map<number, RelayRow>();
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("SELECT private_chat_id")) {
      const row = [...rows.values()].find((candidate) =>
        candidate.forumChatId === values?.[0] && candidate.forumMessageId === values?.[1] &&
        candidate.status === "sent");
      return { rowCount: row ? 1 : 0, rows: row ? [{ private_chat_id: row.privateChatId }] : [] };
    }
    if (sql.includes("INSERT INTO reception_relay_updates")) {
      const updateId = Number(values?.[0]);
      if (rows.has(updateId)) return { rowCount: 0, rows: [] };
      rows.set(updateId, {
        updateId, direction: String(values?.[1]), forumChatId: String(values?.[2]),
        privateChatId: String(values?.[3]), privateMessageId: values?.[4] as number | null,
        forumMessageId: values?.[5] as number | null, status: String(values?.[6]),
      });
      return { rowCount: 1, rows: [{ update_id: updateId }] };
    }
    if (sql.includes("SET status = 'sent'")) {
      const row = rows.get(Number(values?.[0]))!;
      row.status = "sent";
      row.privateMessageId ??= values?.[1] as number | null;
      row.forumMessageId ??= values?.[2] as number | null;
    }
    if (sql.includes("SET status = 'failed'")) {
      const row = rows.get(Number(values?.[0]))!;
      row.status = "failed";
      row.errorCode = String(values?.[1]);
    }
    return { rowCount: 1, rows: [] };
  });
  return { database: { query } as ReceptionRelayDatabase, rows, query };
}

function privateMessage(updateId = 1, extra: Record<string, unknown> = {}) {
  return { update_id: updateId, message: {
    message_id: 11, chat: { id: 42, type: "private" },
    from: { id: 42, is_bot: false, first_name: "Анна", last_name: "Иванова", username: "anna" },
    text: "Привет", ...extra,
  } };
}

function forumReply(updateId = 2, extra: Record<string, unknown> = {}) {
  return { update_id: updateId, message: {
    message_id: 90, chat: { id: -1001234567890, type: "supergroup" },
    message_thread_id: 77, from: { id: 88, is_bot: false },
    reply_to_message: { message_id: 501 }, text: "Здравствуйте", ...extra,
  } };
}

function fakeBot(): ReceptionRelayBot {
  let nextId = 501;
  return {
    sendAttribution: vi.fn(async () => ({ status: "sent" as const, messageId: nextId++ })),
    copyMessage: vi.fn(async () => ({ status: "sent" as const, messageId: nextId++ })),
  };
}

describe("Reception relay", () => {
  beforeEach(() => { receptionConfig.topicId = "77"; });

  it("copies a private message into the configured topic and keeps only routing IDs", async () => {
    const { database, rows } = fakeDatabase();
    const bot = fakeBot();
    expect(await relayReceptionUpdate(privateMessage(), database, bot)).toBe("sent");
    expect(bot.sendAttribution).toHaveBeenCalledWith({
      chatId: "-1001234567890", topicId: 77, text: "От: Анна Иванова (@anna)",
    });
    expect(vi.mocked(bot.sendAttribution).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(bot.copyMessage).mock.invocationCallOrder[0]);
    expect(bot.copyMessage).toHaveBeenCalledWith({
      chatId: "-1001234567890", fromChatId: "42", messageId: 11, topicId: 77,
    });
    expect(rows.get(1)).toMatchObject({
      status: "sent", privateChatId: "42", privateMessageId: 11,
      forumMessageId: 502,
    });
    expect(JSON.stringify(rows.get(1))).not.toContain("Привет");
    expect(JSON.stringify(rows.get(1))).not.toContain("Анна");
  });

  it("uses only the first name when last name and username are absent", async () => {
    const { database } = fakeDatabase();
    const bot = fakeBot();
    expect(await relayReceptionUpdate(privateMessage(1, {
      from: { id: 42, is_bot: false, first_name: "Анна" },
    }), database, bot)).toBe("sent");
    expect(bot.sendAttribution).toHaveBeenCalledWith({
      chatId: "-1001234567890", topicId: 77, text: "От: Анна",
    });
  });

  it("puts attribution before a supported media copy without storing a caption", async () => {
    const { database, rows } = fakeDatabase();
    const bot = fakeBot();
    expect(await relayReceptionUpdate(privateMessage(1, {
      text: undefined, photo: [{ file_id: "photo" }], caption: "Личный текст",
    }), database, bot)).toBe("sent");
    expect(vi.mocked(bot.sendAttribution).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(bot.copyMessage).mock.invocationCallOrder[0]);
    expect(rows.get(1)?.forumMessageId).toBe(502);
    expect(JSON.stringify(rows.get(1))).not.toContain("Личный текст");
  });

  it("copies a reply in the configured topic back to the mapped private chat", async () => {
    const { database, rows } = fakeDatabase();
    const bot = fakeBot();
    await relayReceptionUpdate(privateMessage(), database, bot);
    expect(await relayReceptionUpdate(forumReply(2, { reply_to_message: { message_id: 502 } }), database, bot)).toBe("sent");
    expect(bot.copyMessage).toHaveBeenLastCalledWith({
      chatId: "42", fromChatId: "-1001234567890", messageId: 90,
    });
    expect(rows.get(2)).toMatchObject({
      direction: "forum_to_private", forumMessageId: 90, privateMessageId: 503,
    });
    expect(bot.sendAttribution).toHaveBeenCalledTimes(1);
  });

  it("routes General topic replies and omits its unsupported thread ID on copy", async () => {
    receptionConfig.topicId = "1";
    const { database } = fakeDatabase();
    const bot = fakeBot();
    expect(await relayReceptionUpdate(privateMessage(), database, bot)).toBe("sent");
    expect(bot.copyMessage).toHaveBeenCalledWith({
      chatId: "-1001234567890", fromChatId: "42", messageId: 11,
    });
    expect(bot.sendAttribution).toHaveBeenCalledWith({
      chatId: "-1001234567890", text: "От: Анна Иванова (@anna)",
    });
    expect(await relayReceptionUpdate(forumReply(2, {
      message_thread_id: undefined, is_topic_message: undefined,
      reply_to_message: { message_id: 502 },
    }), database, bot)).toBe("sent");
    expect(bot.copyMessage).toHaveBeenLastCalledWith({
      chatId: "42", fromChatId: "-1001234567890", messageId: 90,
    });
    expect(await relayReceptionUpdate(forumReply(3, {
      is_topic_message: true, message_thread_id: 99,
    }), database, bot)).toBe("ignored");
    expect(bot.copyMessage).toHaveBeenCalledTimes(2);
    expect(bot.sendAttribution).toHaveBeenCalledTimes(1);
  });

  it("ignores wrong forums, wrong topics, unmapped replies and bot messages", async () => {
    const { database, query } = fakeDatabase();
    const bot = fakeBot();
    expect(await relayReceptionUpdate(forumReply(2, { chat: { id: -1009999999999 } }), database, bot)).toBe("ignored");
    expect(await relayReceptionUpdate(forumReply(3, { message_thread_id: 78 }), database, bot)).toBe("ignored");
    expect(await relayReceptionUpdate(forumReply(4), database, bot)).toBe("ignored");
    expect(await relayReceptionUpdate(privateMessage(5, { from: { id: 777, is_bot: true } }), database, bot)).toBe("ignored");
    expect(bot.copyMessage).not.toHaveBeenCalled();
    expect(bot.sendAttribution).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => sql.includes("INSERT INTO reception_relay_updates"))).toBe(false);
  });

  it("claims an update once and never copies a duplicate", async () => {
    const { database } = fakeDatabase();
    const bot = fakeBot();
    expect(await relayReceptionUpdate(privateMessage(), database, bot)).toBe("sent");
    expect(await relayReceptionUpdate(privateMessage(), database, bot)).toBe("duplicate");
    expect(bot.copyMessage).toHaveBeenCalledTimes(1);
    expect(bot.sendAttribution).toHaveBeenCalledTimes(1);
  });

  it("records unsupported messages and delivery failures without throwing", async () => {
    const { database, rows } = fakeDatabase();
    const bot: ReceptionRelayBot = {
      sendAttribution: vi.fn(async () => ({ status: "sent" as const, messageId: 500 })),
      copyMessage: vi.fn(async () => ({ status: "failed" as const, errorCode: "telegram_400" })),
    };
    expect(await relayReceptionUpdate(privateMessage(1, { text: undefined, dice: { emoji: "🎲" } }), database, bot)).toBe("unsupported");
    expect(rows.get(1)?.status).toBe("unsupported");
    expect(await relayReceptionUpdate(privateMessage(2, { text: undefined, photo: [{ file_id: "photo" }] }), database, bot)).toBe("failed");
    expect(rows.get(2)).toMatchObject({ status: "failed", errorCode: "telegram_400" });
    expect(bot.copyMessage).toHaveBeenCalledTimes(1);
    expect(bot.sendAttribution).toHaveBeenCalledTimes(1);
  });

  it("does not copy an anonymous message when attribution fails", async () => {
    const { database, rows } = fakeDatabase();
    const bot: ReceptionRelayBot = {
      sendAttribution: vi.fn(async () => ({ status: "failed" as const, errorCode: "telegram_403" })),
      copyMessage: vi.fn(),
    };
    expect(await relayReceptionUpdate(privateMessage(), database, bot)).toBe("failed");
    expect(bot.copyMessage).not.toHaveBeenCalled();
    expect(rows.get(1)).toMatchObject({ status: "failed", errorCode: "attribution_telegram_403" });
  });

  it("keeps concurrent attribution and copy pairs together", async () => {
    const { database } = fakeDatabase();
    const calls: string[] = [];
    const bot: ReceptionRelayBot = {
      sendAttribution: vi.fn(async () => {
        calls.push("attribution");
        await Promise.resolve();
        return { status: "sent" as const, messageId: calls.length + 500 };
      }),
      copyMessage: vi.fn(async () => {
        calls.push("copy");
        await Promise.resolve();
        return { status: "sent" as const, messageId: calls.length + 500 };
      }),
    };
    await Promise.all([
      relayReceptionUpdate(privateMessage(1), database, bot),
      relayReceptionUpdate(privateMessage(2, { message_id: 12 }), database, bot),
    ]);
    expect(calls).toEqual(["attribution", "copy", "attribution", "copy"]);
  });
});

describe("copyMessage Bot API adapter", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("passes the target topic and reads the created message ID", async () => {
    vi.mocked(fetch).mockResolvedValue({ json: async () => ({ ok: true, result: { message_id: 501 } }) } as Response);
    const result = await receptionRelayBot("token").copyMessage({
      chatId: "-1001234567890", fromChatId: "42", messageId: 11, topicId: 77,
    });
    expect(result).toEqual({ status: "sent", messageId: 501 });
    const [, options] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(options?.body))).toEqual({
      chat_id: "-1001234567890", from_chat_id: "42", message_id: 11,
      message_thread_id: 77,
    });
  });

  it("sends a plain-text attribution to the same topic", async () => {
    vi.mocked(fetch).mockResolvedValue({ json: async () => ({ ok: true, result: { message_id: 500 } }) } as Response);
    const result = await receptionRelayBot("token").sendAttribution({
      chatId: "-1001234567890", text: "От: Анна Иванова (@anna)", topicId: 77,
    });
    expect(result).toEqual({ status: "sent", messageId: 500 });
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottoken/sendMessage");
    expect(JSON.parse(String(options?.body))).toEqual({
      chat_id: "-1001234567890", text: "От: Анна Иванова (@anna)", message_thread_id: 77,
    });
  });
});
