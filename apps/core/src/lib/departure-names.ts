import type { GuardianDeparture } from "./guardian-departures";

const PLACEHOLDER = "Участник форума";
// The placeholder tells nothing about who left: fall back to anything the person is actually known by.
export function departureName(event: GuardianDeparture): string | null {
  const own = event.displayName && event.displayName !== PLACEHOLDER ? event.displayName : null;
  return own ?? event.telegramOwnName ?? event.archivedDisplayName
    ?? (event.telegramUsername ? `@${event.telegramUsername}` : null) ?? event.archivedUsername ?? event.displayName;
}
export function departureHandle(event: GuardianDeparture): string | null {
  const username = event.telegramUsername ? `@${event.telegramUsername}` : event.archivedUsername;
  return username && username !== departureName(event) ? username : null;
}
