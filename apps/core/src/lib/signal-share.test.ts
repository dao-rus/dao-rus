import { describe, expect, it, vi } from "vitest";
import { copySignalShareUrl, signalShareLinks, signalShareMessage, tryNativeSignalShare } from "./signal-share";

const url = "https://core.daorus.org/exchange/10000000-0000-4000-8000-000000000001";
const labelOnly = { label: "Ищу работу", description: null, url };
const withDescription = { label: "Ищу работу", description: "Нужен уважительный коллектив.", url };

describe("Signal share", () => {
  it("formats the message as label, optional description and canonical URL only", () => {
    expect(signalShareMessage(labelOnly)).toBe(`Ищу работу\n\n${url}`);
    expect(signalShareMessage(withDescription)).toBe(`Ищу работу\nНужен уважительный коллектив.\n\n${url}`);
    for (const payload of [labelOnly, withDescription]) {
      const everything = JSON.stringify(signalShareLinks(payload)) + signalShareMessage(payload);
      expect(decodeURIComponent(everything.replaceAll("+", " "))).not.toContain("Сигнал в сети");
    }
  });
  it("passes the same text and URL to Web Share API", async () => {
    const share = vi.fn(async () => {});
    expect(await tryNativeSignalShare(share, withDescription)).toBe("shared");
    expect(share).toHaveBeenCalledExactlyOnceWith({ text: "Ищу работу\nНужен уважительный коллектив.", url });
  });
  it("offers fallback when native share is missing or fails, but not after cancellation", async () => {
    expect(await tryNativeSignalShare(undefined, labelOnly)).toBe("fallback");
    expect(await tryNativeSignalShare(async () => { throw new Error("failed"); }, labelOnly)).toBe("fallback");
    const abort = new Error("cancelled"); abort.name = "AbortError";
    expect(await tryNativeSignalShare(async () => { throw abort; }, labelOnly)).toBe("cancelled");
  });
  it("builds Telegram, VK, OK, WhatsApp and email links from the same content", () => {
    const links = signalShareLinks(withDescription);
    const telegram = new URL(links.telegram);
    expect(telegram.origin + telegram.pathname).toBe("https://t.me/share/url");
    expect(telegram.searchParams.get("url")).toBe(url);
    expect(telegram.searchParams.get("text")).toBe("Ищу работу\nНужен уважительный коллектив.");
    const vk = new URL(links.vk);
    expect(vk.origin + vk.pathname).toBe("https://vk.com/share.php");
    expect(vk.searchParams.get("url")).toBe(url);
    expect(vk.searchParams.get("title")).toBe("Ищу работу");
    expect(vk.searchParams.get("comment")).toBe("Нужен уважительный коллектив.");
    const ok = new URL(links.ok);
    expect(ok.origin + ok.pathname).toBe("https://connect.ok.ru/offer");
    expect(ok.searchParams.get("url")).toBe(url);
    expect(ok.searchParams.get("title")).toBe("Ищу работу");
    const whatsapp = new URL(links.whatsapp);
    expect(whatsapp.origin + whatsapp.pathname).toBe("https://wa.me/");
    expect(whatsapp.searchParams.get("text")).toBe(signalShareMessage(withDescription));
    expect(links.email).toContain("subject=%D0%98%D1%89%D1%83");
    expect(decodeURIComponent(links.email)).toContain(signalShareMessage(withDescription));
  });
  it("omits VK comment and keeps a bare label message when there is no description", () => {
    expect(new URL(signalShareLinks(labelOnly).vk).searchParams.has("comment")).toBe(false);
    expect(new URL(signalShareLinks(labelOnly).telegram).searchParams.get("text")).toBe("Ищу работу");
  });
  it("copies only the canonical URL and reports clipboard failure", async () => {
    const write = vi.fn(async () => {});
    expect(await copySignalShareUrl(write, url)).toBe(true);
    expect(write).toHaveBeenCalledExactlyOnceWith(url);
    expect(await copySignalShareUrl(async () => { throw new Error("blocked"); }, url)).toBe(false);
    expect(await copySignalShareUrl(undefined, url)).toBe(false);
  });
});
