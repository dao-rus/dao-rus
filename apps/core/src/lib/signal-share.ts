export type SignalSharePayload = { title: string; text: string; url: string };

export function signalShareLinks({ title, text, url }: SignalSharePayload) {
  const telegram = new URL("https://t.me/share/url");
  telegram.searchParams.set("url", url);
  telegram.searchParams.set("text", text);
  const vk = new URL("https://vk.com/share.php");
  vk.searchParams.set("url", url);
  vk.searchParams.set("title", title);
  vk.searchParams.set("comment", text);
  const ok = new URL("https://connect.ok.ru/offer");
  ok.searchParams.set("url", url);
  ok.searchParams.set("title", title);
  const whatsapp = new URL("https://wa.me/");
  whatsapp.searchParams.set("text", `${text}
${url}`);
  const email = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text}\n${url}`)}`;
  return { telegram: telegram.toString(), vk: vk.toString(), ok: ok.toString(),
    whatsapp: whatsapp.toString(), email };
}

export async function tryNativeSignalShare(
  share: ((payload: SignalSharePayload) => Promise<void>) | undefined,
  payload: SignalSharePayload,
): Promise<"shared" | "cancelled" | "fallback"> {
  if (!share) return "fallback";
  try {
    await share(payload);
    return "shared";
  } catch (error) {
    return error instanceof Error && error.name === "AbortError" ? "cancelled" : "fallback";
  }
}

export async function copySignalShareUrl(
  writeText: ((text: string) => Promise<void>) | undefined, url: string,
): Promise<boolean> {
  if (!writeText) return false;
  try { await writeText(url); return true; } catch { return false; }
}
