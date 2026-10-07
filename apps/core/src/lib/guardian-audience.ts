export { cityKey, audienceConditions as guardianAudienceConditions } from "./participant-audience";
export type { ParticipantAudienceDatabase as GuardianAudienceDatabase, AudienceParticipant as GuardianParticipant, AudienceCondition as GuardianAudienceCondition, AudienceFilters as GuardianFilters } from "./participant-audience";
import { selectParticipantAudienceWithDatabase, type ParticipantAudienceDatabase, type AudienceFilters } from "./participant-audience";
export function getGuardianAudienceWithDatabase(database: ParticipantAudienceDatabase, filters: AudienceFilters = {}) {
  return selectParticipantAudienceWithDatabase(database, filters, "guardian");
}
export async function getGuardianAudience(filters: AudienceFilters = {}) {
  const { pool } = await import("./db");
  return getGuardianAudienceWithDatabase(pool, filters);
}
