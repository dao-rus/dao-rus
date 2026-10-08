import { hasAwardCapability } from "@/lib/award-access";
import { hasPrototypeAdminAccess } from "@/lib/config";
import { adminGroups, type AdminGroup, type AdminSection } from "./admin-sections";

// Who may open which section of the management area. Kept apart from the section list so that the
// breadcrumb, which only needs names, does not pull in access checks.

export function canOpenAdminSection(participantId: string, section: AdminSection): boolean {
  return section.access === "admin" ? hasPrototypeAdminAccess(participantId) : hasAwardCapability(participantId, section.access);
}

/** Groups with only the sections this participant may open; empty groups are dropped. */
export function visibleAdminGroups(participantId: string): AdminGroup[] {
  return adminGroups
    .map((group) => ({ ...group, sections: group.sections.filter((section) => canOpenAdminSection(participantId, section)) }))
    .filter((group) => group.sections.length > 0);
}

/** Whether the participant may open anything in the management area. */
export function hasAnyAdminSection(participantId: string): boolean {
  return visibleAdminGroups(participantId).length > 0;
}
