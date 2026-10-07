// A Core path carried through Telegram: as `startapp` of a bot link (forum buttons) or as
// the `start` query of a Mini App button (private messages). Safe on client and server.
const MAX_PATH = 300;

export function isSafeCorePath(path: string): boolean {
  return path.length <= MAX_PATH && path.startsWith("/") && !path.startsWith("//")
    && !path.includes("\\") && !/[\u0000-\u001f]/u.test(path);
}

export function encodeStartPath(path: string): string {
  if (!isSafeCorePath(path)) throw new Error("Invalid Core path");
  let binary = "";
  for (const byte of new TextEncoder().encode(path)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

// Anything that is not a clean internal path decodes to null: a start code can never redirect off Core.
export function decodeStartPath(code: unknown): string | null {
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{1,512}$/u.test(code)) return null;
  try {
    const binary = atob(code.replaceAll("-", "+").replaceAll("_", "/"));
    const path = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    return isSafeCorePath(path) ? path : null;
  } catch { return null; }
}

// Where the Mini App entry page should continue after sign-in, if it was opened with a start code.
export function startTarget(search: string, telegramStartParam?: string): string | null {
  const params = new URLSearchParams(search);
  return decodeStartPath(params.get("start")) ?? decodeStartPath(params.get("tgWebAppStartParam")) ?? decodeStartPath(telegramStartParam);
}
