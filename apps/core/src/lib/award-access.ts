import { founderParticipantId } from "./config";

export type AwardCapability = "award.establish" | "award.offer";

export class AwardAccessError extends Error {
  constructor(message = "Award authority required") {
    super(message);
    this.name = "AwardAccessError";
  }
}

// Replace this policy when institutional authority is transferred. Recorded authors stay unchanged.
export function hasAwardCapability(participantId: string, capability: AwardCapability): boolean {
  if (capability !== "award.establish" && capability !== "award.offer") return false;
  const founder = founderParticipantId();
  return founder !== null && participantId.toLowerCase() === founder;
}

export function requireAwardCapability(participantId: string, capability: AwardCapability): void {
  if (!hasAwardCapability(participantId, capability)) throw new AwardAccessError();
}
