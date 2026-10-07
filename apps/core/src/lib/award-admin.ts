import { notFound, redirect } from "next/navigation";
import { getCurrentParticipant } from "./session";
import { hasAwardCapability } from "./award-access";
import { id, AwardValidationError } from "./awards";
export async function requireAwardAdmin() {
    const actor = await getCurrentParticipant();
    if (!actor)
        redirect("/");
    if (!hasAwardCapability(actor.id, "award.establish"))
        notFound();
    return actor;
}
export function awardRouteId(value: string) { try {
    return id(value);
}
catch (error) {
    if (error instanceof AwardValidationError)
        notFound();
    throw error;
} }
