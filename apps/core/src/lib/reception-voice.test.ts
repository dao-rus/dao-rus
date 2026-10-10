import { afterEach, describe, expect, it, vi } from "vitest";
import { greetOnStart, onReceptionStart, receptionApplicationButton } from "./reception-voice";
import { interfaceTextFields, type InterfaceTextValues } from "./interface-texts";
const texts = Object.fromEntries(interfaceTextFields.map(field => [field.key, field.defaultValue])) as InterfaceTextValues;
vi.mock("./config", () => ({ telegramReceptionConfig: () => ({ token: "synthetic", forumChatId: "-100123", miniAppEnabled: true }), appBaseUrl: () => "https://core.example" }));
vi.mock("./guardian-forum", async original => ({ ...await original<typeof import("./guardian-forum")>(), readGuardianSettings: async () => new Map() }));
vi.mock("./interface-texts", async original => ({ ...await original<typeof import("./interface-texts")>(), readInterfaceTexts: async () => ({ values: texts }) }));
afterEach(() => vi.unstubAllGlobals());

describe("Reception Mini App launch button", () => {
  it("uses a direct Reception HTTPS web_app URL, independent of Dev bot start paths", () => {
    expect(receptionApplicationButton("https://core.example/need", true, "Заполнить анкету")).toEqual({ text: "Заполнить анкету", web_app: { url: "https://core.example/reception/apply" } });
    expect(receptionApplicationButton("https://core.example", false, "Apply")).toBeUndefined();
    expect(receptionApplicationButton("http://core.example", true, "Apply")).toBeUndefined();
    expect(receptionApplicationButton("invalid", true, "Apply")).toBeUndefined();
  });
  it("adds the button to the existing greeting without changing its text", async () => {
    const send = vi.fn(async () => {});
    const applyButton = receptionApplicationButton("https://core.example", true, texts["reception.apply.button"]);
    await greetOnStart({ settings: new Map(), texts, send, isMember: async () => false, applyButton }, "42");
    expect(send).toHaveBeenCalledWith("42", texts["reception.greeting"], applyButton);
  });
  it.each(["left", "member"])("sends a Reception web_app keyboard for /start (%s)", async membership => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("getChatMember")
      ? { ok: true, result: { status: membership } } : { ok: true, result: { message_id: 1 } })));
    vi.stubGlobal("fetch", fetchMock); await onReceptionStart("42");
    const send = fetchMock.mock.calls.find(([url]) => url.endsWith("sendMessage"));
    expect(send).toBeDefined();
    const options = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => url.endsWith("sendMessage"))![1];
    expect(JSON.parse(options.body as string)).toMatchObject({ chat_id: 42, reply_markup: { inline_keyboard: [[{ text: texts["reception.apply.button"], web_app: { url: "https://core.example/reception/apply" } }]] } });
    expect(fetchMock.mock.calls.some(([url]) => !url.endsWith("sendMessage") && !url.endsWith("getChatMember"))).toBe(false);
  });
});
