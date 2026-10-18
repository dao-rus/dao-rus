const signalCardPath = /^\/(?:exchange|award-offers)\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const slovotvorWordPath = /^\/slovotvor\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slovotvorTaskPath = /^\/slovotvor\?parent=[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
// Same shape as the awards.slug CHECK; the shared award link works for every recipient.
const awardPagePath = /^\/awards\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Only fixed internal destinations may survive the Telegram login round trip.
export function safeAuthReturnPath(value: string | null | undefined): string | null {
  if (value === "/slovotvor") return value;
  if (value && slovotvorWordPath.test(value)) return value;
  if (value && slovotvorTaskPath.test(value)) return value;
  if (value === "/need") return value;
  if (value && value.length <= 100 + "/awards/".length && awardPagePath.test(value)) return value;
  return value && signalCardPath.test(value) ? value : null;
}
