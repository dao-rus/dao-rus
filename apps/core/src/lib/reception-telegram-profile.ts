// Only call with authenticated Telegram claims or a checked getChat response.
export function receptionTelegramName(first: string | null, last: string | null) {
  return [first, last].filter(Boolean).join(" ").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 256);
}
export function receptionTelegramUsername(username: string | null) {
  return username && /^[A-Za-z0-9_]{1,32}$/.test(username) ? username : null;
}
