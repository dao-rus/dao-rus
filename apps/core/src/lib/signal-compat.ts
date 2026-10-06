import {
  createLegacySignalWithDatabase, normalizeSignalTypeKey, normalizeSignalVisibility,
  SignalValidationError, type Signal, type SignalDatabase,
} from "./signals";
import { normalizeBoundedText } from "./profile-validation";

// A list for the old forms only, not the domain's ontology.
export const PROFILE_SIGNAL_KINDS = ["want", "need", "can", "have"] as const;
export type LegacyProfileSignalKind = (typeof PROFILE_SIGNAL_KINDS)[number];

export function signalBodyProjection(signal: Pick<Signal, "label" | "description">): string {
  return signal.label + (signal.description === null ? "" : "\n\n" + signal.description);
}
export function normalizeSignalBody(value: unknown): string {
  return normalizeBoundedText(value, "Signal", 500);
}
export async function addLegacyProfileSignalWithDatabase(
  database: SignalDatabase, ownerId: string, kindValue: unknown, bodyValue: unknown, visibilityValue: unknown,
) {
  const typeKey = normalizeSignalTypeKey(kindValue);
  if (!PROFILE_SIGNAL_KINDS.includes(typeKey as LegacyProfileSignalKind)) {
    throw new SignalValidationError("Structured content required for this signal type");
  }
  const body = normalizeSignalBody(bodyValue);
  const visibility = normalizeSignalVisibility(visibilityValue, typeKey);
  return (await createLegacySignalWithDatabase(database, ownerId, typeKey, body, visibility)).reward;
}
