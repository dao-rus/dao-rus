export function safeActionUrl(value: string | null | undefined): string | null {
  if (value == null) return null;
  const url = value.trim();
  if (!url) return null;
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\") && !/[\u0000-\u001f]/u.test(url)) return url;
  if (/^https:\/\//iu.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return url;
    } catch { /* Invalid URL. */ }
  }
  throw new Error("Invalid notification action URL");
}
