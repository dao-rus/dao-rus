import { describe, expect, it, vi } from "vitest";
import { copySignalShareUrl, signalShareLinks, tryNativeSignalShare } from "./signal-share";

const payload = { title: "Ищу работу", text: "Сигнал в сети ДАО Русь.",
  url: "https://core.daorus.org/exchange/10000000-0000-4000-8000-000000000001" };

describe("Signal share", () => {
  it("passes only the safe canonical payload to Web Share API", async () => {
    const share = vi.fn(async () => {});
    expect(await tryNativeSignalShare(share, payload)).toBe("shared");
    expect(share).toHaveBeenCalledExactlyOnceWith(payload);
  });
  it("offers fallback when native share is missing or fails, but not after cancellation", async () => {
    expect(await tryNativeSignalShare(undefined, payload)).toBe("fallback");
    expect(await tryNativeSignalShare(async () => { throw new Error("failed"); }, payload)).toBe("fallback");
    const abort = new Error("cancelled"); abort.name = "AbortError";
    expect(await tryNativeSignalShare(async () => { throw abort; }, payload)).toBe("cancelled");
  });
  it("builds Telegram, VK and email links with encoded content", () => {
    const links = signalShareLinks(payload);
    const telegram = new URL(links.telegram);
    expect(telegram.origin + telegram.pathname).toBe("https://t.me/share/url");
    expect(telegram.searchParams.get("url")).toBe(payload.url);
    expect(telegram.searchParams.get("text")).toBe(payload.text);
    const vk = new URL(links.vk);
    expect(vk.origin + vk.pathname).toBe("https://vk.com/share.php");
    expect(vk.searchParams.get("url")).toBe(payload.url);
    expect(vk.searchParams.get("title")).toBe(payload.title);
    expect(vk.searchParams.get("comment")).toBe(payload.text);
    expect(links.email).toContain("subject=%D0%98%D1%89%D1%83");
    expect(decodeURIComponent(links.email)).toContain(payload.url);
  });
  it("reports clipboard success and failure without sending the link elsewhere", async () => {
    const write = vi.fn(async () => {});
    expect(await copySignalShareUrl(write, payload.url)).toBe(true);
    expect(write).toHaveBeenCalledWith(payload.url);
    expect(await copySignalShareUrl(async () => { throw new Error("blocked"); }, payload.url)).toBe(false);
    expect(await copySignalShareUrl(undefined, payload.url)).toBe(false);
  });
});
