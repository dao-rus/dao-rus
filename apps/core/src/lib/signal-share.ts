export type SignalSharePayload = { label: string; description: string | null; url: string };

// Shared message: the card content and its canonical URL only.
export function signalShareText({ label, description }: Pick<SignalSharePayload, "label" | "description">): string {
  return description ? `${label}\n${description}` : label;
}
export function signalShareMessage(payload: SignalSharePayload): string {
  return `${signalShareText(payload)}\n\n${payload.url}`;
}

export function signalShareLinks(payload: SignalSharePayload) {
  const { label, description, url } = payload;
  const telegram = new URL("https://t.me/share/url");
  telegram.searchParams.set("url", url);
  telegram.searchParams.set("text", signalShareText(payload));
  const vk = new URL("https://vk.com/share.php");
  vk.searchParams.set("url", url);
  vk.searchParams.set("title", label);
  if (description) vk.searchParams.set("comment", description);
  const ok = new URL("https://connect.ok.ru/offer");
  ok.searchParams.set("url", url);
  ok.searchParams.set("title", label);
  const whatsapp = new URL("https://wa.me/");
  whatsapp.searchParams.set("text", signalShareMessage(payload));
  const email = `mailto:?subject=${encodeURIComponent(label)}&body=${encodeURIComponent(signalShareMessage(payload))}`;
  return { telegram: telegram.toString(), vk: vk.toString(), ok: ok.toString(),
    whatsapp: whatsapp.toString(), email };
}

export async function tryNativeSignalShare(
  share: ((data: { text: string; url: string }) => Promise<void>) | undefined,
  payload: SignalSharePayload,
): Promise<"shared" | "cancelled" | "fallback"> {
  if (!share) return "fallback";
  try {
    await share({ text: signalShareText(payload), url: payload.url });
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
