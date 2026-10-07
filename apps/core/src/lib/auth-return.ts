const signalCardPath = /^\/(?:exchange|award-offers)\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

// Only fixed internal destinations may survive the Telegram login round trip.
export function safeAuthReturnPath(value: string | null | undefined): string | null {
  if (value === "/need") return value;
  return value && signalCardPath.test(value) ? value : null;
}
