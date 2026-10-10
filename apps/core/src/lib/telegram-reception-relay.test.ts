import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  receptionErrorCode,
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
  headingId?: number | null;
  status: string;
  errorCode?: string;
};

function fakeDatabase() {
  const rows = new Map<number, RelayRow>();
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("SELECT private_chat_id")) {
      const row = [...rows.values()].find((candidate) =>
        candidate.forumChatId === values?.[0] && (candidate.forumMessageId === values?.[1] || candidate.headingId === values?.[1]) &&
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
    if (sql.includes("SET forum_heading_message_id=")) rows.get(Number(values?.[0]))!.headingId=Number(values?.[1]);
    if (sql.includes("SET status = 'sent'")) {
      const row = rows.get(Number(values?.[0]))!;
      row.status = "sent";
      row.privateMessageId ??= values?.[1] as number | null;
      row.forumMessageId ??= values?.[2] as number | null;
      row.headingId = values?.[3] as number | null;
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

  it("relays a text message into the configured topic as one message, name on top, and keeps only routing IDs", async () => {
    const { database, rows } = fakeDatabase();
    const bot = fakeBot();
    expect(await relayReceptionUpdate(privateMessage(), database, bot)).toBe("sent");
    expect(bot.sendAttribution).toHaveBeenCalledTimes(1);
    expect(bot.sendAttribution).toHaveBeenCalledWith({
      chatId: "-1001234567890", topicId: 77, text: "От: Анна Иванова (@anna)\n\nПривет", entities: [],
    });
    expect(bot.copyMessage).not.toHaveBeenCalled();
    expect(rows.get(1)).toMatchObject({
      status: "sent", privateChatId: "42", privateMessageId: 11,
      forumMessageId: 501,
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
      chatId: "-1001234567890", topicId: 77, text: "От: Анна\n\nПривет", entities: [],
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
    expect(await relayReceptionUpdate(forumReply(2, { reply_to_message: { message_id: 501 } }), database, bot)).toBe("sent");
    expect(bot.copyMessage).toHaveBeenLastCalledWith({
      chatId: "42", fromChatId: "-1001234567890", messageId: 90,
    });
    expect(rows.get(2)).toMatchObject({
      direction: "forum_to_private", forumMessageId: 90, privateMessageId: 502,
    });
    expect(bot.sendAttribution).toHaveBeenCalledTimes(1);
  });

  it("routes General topic replies and omits its unsupported thread ID on copy", async () => {
    receptionConfig.topicId = "1";
    const { database } = fakeDatabase();
    const bot = fakeBot();
    expect(await relayReceptionUpdate(privateMessage(), database, bot)).toBe("sent");
    expect(bot.sendAttribution).toHaveBeenCalledWith({
      chatId: "-1001234567890", text: "От: Анна Иванова (@anna)\n\nПривет", entities: [],
    });
    expect(await relayReceptionUpdate(forumReply(2, {
      message_thread_id: undefined, is_topic_message: undefined,
      reply_to_message: { message_id: 501 },
    }), database, bot)).toBe("sent");
    expect(bot.copyMessage).toHaveBeenLastCalledWith({
      chatId: "42", fromChatId: "-1001234567890", messageId: 90,
    });
    expect(await relayReceptionUpdate(forumReply(3, {
      is_topic_message: true, message_thread_id: 99,
    }), database, bot)).toBe("ignored");
    expect(bot.copyMessage).toHaveBeenCalledTimes(1);
    expect(bot.sendAttribution).toHaveBeenCalledTimes(1);
  });

  it("delivers a reply to either message of a relayed photo: the name line or the copy", async () => {
    const { database, rows } = fakeDatabase();
    const bot = fakeBot();
    expect(await relayReceptionUpdate(privateMessage(1, { text: undefined, photo: [{ file_id: "photo" }] }), database, bot)).toBe("sent");
    expect(bot.sendAttribution).toHaveBeenCalledWith({ chatId: "-1001234567890", topicId: 77, text: "От: Анна Иванова (@anna)" });
    expect(rows.get(1)).toMatchObject({ forumMessageId: 502, headingId: 501 });
    for (const [update, target] of [[2, 501], [3, 502]] as const) {
      expect(await relayReceptionUpdate(forumReply(update, { message_id: 90 + update, reply_to_message: { message_id: target } }), database, bot)).toBe("sent");
      expect(bot.copyMessage).toHaveBeenLastCalledWith({ chatId: "42", fromChatId: "-1001234567890", messageId: 90 + update });
    }
    expect(await relayReceptionUpdate(forumReply(4, { reply_to_message: { message_id: 777 } }), database, bot)).toBe("ignored");
  });

  it("keeps the applicant's formatting in the single message, and drops it rather than lose the words", async () => {
    const { database } = fakeDatabase();
    const bot = fakeBot();
    const entities = [{ type: "bold", offset: 0, length: 6 }, { type: "text_link", offset: 7, length: 4, url: "https://example.org" }, { type: "broken" }];
    await relayReceptionUpdate(privateMessage(1, { text: "Привет сайт", entities }), database, bot);
    const prefix = "От: Анна Иванова (@anna)\n\n";
    expect(bot.sendAttribution).toHaveBeenCalledWith({ chatId: "-1001234567890", topicId: 77, text: prefix + "Привет сайт",
      entities: [{ type: "bold", offset: prefix.length, length: 6 }, { type: "text_link", offset: prefix.length + 7, length: 4, url: "https://example.org" }] });
    // Telegram refuses the formatting: the same text is sent once more without it.
    const picky: ReceptionRelayBot = {
      sendAttribution: vi.fn(async (input: { entities?: unknown[] }) => input.entities?.length
        ? { status: "failed" as const, errorCode: "telegram_400_parse_entities" } : { status: "sent" as const, messageId: 700 }),
      copyMessage: vi.fn(),
    };
    expect(await relayReceptionUpdate(privateMessage(2, { text: "Привет сайт", entities }), database, picky)).toBe("sent");
    expect(picky.sendAttribution).toHaveBeenCalledTimes(2);
    expect(vi.mocked(picky.sendAttribution).mock.calls[1][0]).toEqual({ chatId: "-1001234567890", topicId: 77, text: prefix + "Привет сайт" });
    expect(picky.copyMessage).not.toHaveBeenCalled();
  });

  it.each(['network_or_timeout','telegram_500','invalid_response','telegram_403','telegram_400'])('never blindly repeats a formatted message after %s',async errorCode=>{
    const {database,rows}=fakeDatabase();const bot:ReceptionRelayBot={sendAttribution:vi.fn(async()=>({status:'failed' as const,errorCode})),copyMessage:vi.fn()};
    await relayReceptionUpdate(privateMessage(99,{entities:[{type:'bold',offset:0,length:3}]}),database,bot);
    expect(bot.sendAttribution).toHaveBeenCalledTimes(1);expect(rows.get(99)?.status).toBe('failed');
    expect(await relayReceptionUpdate(privateMessage(99),database,bot)).toBe('duplicate');expect(bot.sendAttribution).toHaveBeenCalledTimes(1);
  });
  it("falls back to the name line plus a copy when the text would not fit into one message", async () => {
    const { database, rows } = fakeDatabase();
    const bot = fakeBot();
    expect(await relayReceptionUpdate(privateMessage(1, { text: "я".repeat(4090) }), database, bot)).toBe("sent");
    expect(bot.sendAttribution).toHaveBeenCalledWith({ chatId: "-1001234567890", topicId: 77, text: "От: Анна Иванова (@anna)" });
    expect(bot.copyMessage).toHaveBeenCalledTimes(1);
    expect(rows.get(1)).toMatchObject({ forumMessageId: 502, headingId: 501 });
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
    expect(bot.copyMessage).not.toHaveBeenCalled();
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
    expect(rows.get(2)).toMatchObject({ status: "failed", errorCode: "telegram_400", headingId:500 });
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
    expect(rows.get(1)).toMatchObject({ status: "failed", errorCode: "telegram_403" });
    expect(await relayReceptionUpdate(privateMessage(2, { text: undefined, photo: [{ file_id: "photo" }] }), database, bot)).toBe("failed");
    expect(bot.copyMessage).not.toHaveBeenCalled();
    expect(rows.get(2)).toMatchObject({ status: "failed", errorCode: "attribution_telegram_403" });
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
      relayReceptionUpdate(privateMessage(1, { text: undefined, voice: { file_id: "v1" } }), database, bot),
      relayReceptionUpdate(privateMessage(2, { message_id: 12, text: undefined, voice: { file_id: "v2" } }), database, bot),
    ]);
    expect(calls).toEqual(["attribution", "copy", "attribution", "copy"]);
  });
});

describe("copyMessage Bot API adapter", () => {
  it('keeps actionable categories without retaining arbitrary text or private data',()=>{
    expect(receptionErrorCode({error_code:400,description:"Bad Request: can't parse entities: private content"})).toBe('telegram_400_parse_entities');
    expect(receptionErrorCode({error_code:400,description:'private text nobody should see'})).toBe('telegram_400');
    expect(receptionErrorCode({error_code:429,parameters:{retry_after:30}})).toBe('telegram_429_retry_after_30');
  });
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
      link_preview_options: { is_disabled: true },
    });
  });
});
