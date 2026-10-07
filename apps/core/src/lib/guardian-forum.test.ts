import { describe, expect, it, vi } from "vitest";
import {
  ForumBotError, coreButtonUrl, forumInternalId, forumMessageLink, normalizeBotUsername, parseTopicLink, telegramForumBot,
} from "./guardian-forum";
import { decodeStartPath, encodeStartPath, startTarget } from "./mini-app-start";

const forum = "-1001725482832";

describe("forum topic links", () => {
  it("reads the topic number from this forum's link or a bare number, and clears on empty", () => {
    expect(forumInternalId(forum)).toBe("1725482832");
    expect(parseTopicLink("https://t.me/c/1725482832/90117", forum)).toBe(90117);
    expect(parseTopicLink(" https://t.me/c/1725482832/18350/555?single ", forum)).toBe(18350);
    expect(parseTopicLink("298", forum)).toBe(298);
    expect(parseTopicLink("", forum)).toBeNull();
    expect(parseTopicLink(null, forum)).toBeNull();
    expect(forumMessageLink(forum, 298, 12)).toBe("https://t.me/c/1725482832/298/12");
    expect(forumMessageLink(undefined, 298)).toBeNull();
  });
  it.each(["https://t.me/c/999999999/90117", "https://t.me/somechat/5", "http://t.me/c/1725482832/5", "0", "-3", "abc",
    "https://t.me/c/1725482832/5/../../x", "javascript:alert(1)"])("rejects %s", (value) => {
    expect(() => parseTopicLink(value, forum)).toThrow();
  });
  it("accepts a bot name with or without @ and rejects anything that is not one", () => {
    expect(normalizeBotUsername("@DaoRus_Bot")).toBe("DaoRus_Bot");
    expect(normalizeBotUsername("https://t.me/DaoRusBot")).toBe("DaoRusBot");
    expect(normalizeBotUsername(" ")).toBeNull();
    for (const bad of ["a b", "bot/../x", "1bot5", "ab"]) expect(() => normalizeBotUsername(bad)).toThrow();
  });
});

describe("a Core path carried through Telegram", () => {
  it("round-trips internal paths, including Cyrillic queries", () => {
    for (const path of ["/exchange/10000000-0000-4000-8000-000000000001", "/exchange?type=dating", "/nearby", "/exchange/new?type=need&x=привет"]) {
      const code = encodeStartPath(path);
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeStartPath(code)).toBe(path);
    }
  });
  it("never yields anything but a clean internal path", () => {
    const raw = (value: string) => Buffer.from(value).toString("base64url");
    for (const evil of ["//evil.example/x", "https://evil.example", "\\\\evil", "/a\nb", "relative"]) {
      expect(() => encodeStartPath(evil)).toThrow();
      expect(decodeStartPath(raw(evil))).toBeNull();
    }
    for (const junk of [null, 5, "", "!!!", "a".repeat(600), raw("/" + "a".repeat(400))]) expect(decodeStartPath(junk)).toBeNull();
  });
  it("finds the target in our own query, Telegram's query or its start parameter", () => {
    const code = encodeStartPath("/nearby");
    expect(startTarget(`?start=${code}`)).toBe("/nearby");
    expect(startTarget(`?tgWebAppStartParam=${code}`)).toBe("/nearby");
    expect(startTarget("", code)).toBe("/nearby");
    expect(startTarget("?start=garbage!", undefined)).toBeNull();
  });
  it("opens inside Telegram only when the bot name is set and the switch is on", () => {
    const base = "https://core.daorus.org";
    expect(coreButtonUrl("/nearby", new Map(), base)).toBe("https://core.daorus.org/nearby");
    expect(coreButtonUrl("/nearby", new Map([["miniapp.bot", "DaoRusBot"]]), base)).toBe(`https://t.me/DaoRusBot?startapp=${encodeStartPath("/nearby")}`);
    expect(coreButtonUrl("/nearby", new Map([["miniapp.bot", "DaoRusBot"], ["feature.forum_buttons", "off"]]), base)).toBe("https://core.daorus.org/nearby");
  });
});

describe("Telegram forum bot", () => {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  it("sends plain text into the topic of the configured forum and returns the message number", async () => {
    const request = vi.fn(async () => reply({ ok: true, result: { message_id: 77 } }));
    const id = await telegramForumBot("123:token", forum, request as never).send(298, "<b>не разметка</b>", [{ text: "Открыть", url: "https://core.daorus.org/x" }]);
    expect(id).toBe(77);
    const [url, init] = request.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toBe("https://api.telegram.org/bot123:token/sendMessage");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ chat_id: -1001725482832, message_thread_id: 298, text: "<b>не разметка</b>" });
    expect(body.parse_mode).toBeUndefined();
    expect(body.reply_markup.inline_keyboard).toEqual([[{ text: "Открыть", url: "https://core.daorus.org/x" }]]);
  });
  it("reports Telegram's own reason, and treats an unchanged edit as success", async () => {
    const denied = vi.fn(async () => reply({ ok: false, description: "Bad Request: not enough rights to send text messages to the chat" }, 400));
    await expect(telegramForumBot("t", forum, denied as never).send(1, "x", [])).rejects.toMatchObject({ detail: expect.stringContaining("not enough rights") });
    const same = vi.fn(async () => reply({ ok: false, description: "Bad Request: message is not modified" }, 400));
    await expect(telegramForumBot("t", forum, same as never).edit(5, "x", [])).resolves.toBeUndefined();
    const down = vi.fn(async () => { throw new Error("network"); });
    await expect(telegramForumBot("t", forum, down as never).send(1, "x", [])).rejects.toBeInstanceOf(ForumBotError);
    const long = vi.fn(async () => reply({ ok: true, result: { message_id: 1 } }));
    await telegramForumBot("t", forum, long as never).send(1, "я".repeat(5000), []);
    expect(JSON.parse((long.mock.calls[0] as unknown as [string, { body: string }])[1].body).text).toHaveLength(4096);
  });
});
