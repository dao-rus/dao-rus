import { NextRequest, NextResponse } from "next/server";
import { getCurrentParticipant } from "@/lib/session";
import { hasAwardCapability } from "@/lib/award-access";
import { id, AwardValidationError } from "@/lib/awards";
import { createAwardBatch, snapshotAwardAudience, addAwardCandidate, editAwardCandidate, finalizeAwardBatch } from "@/lib/award-batches";
import { awardRequestForbidden, awardRedirect, awardHttpError } from "@/lib/award-http";
import type { AudienceCondition } from "@/lib/participant-audience";
import { pool } from "@/lib/db";
export async function POST(request: NextRequest) {
    if (awardRequestForbidden(request))
        return new NextResponse("Forbidden", { status: 403 });
    const actor = await getCurrentParticipant();
    if (!actor)
        return new NextResponse("Unauthorized", { status: 401 });
    if (!hasAwardCapability(actor.id, "award.batch.edit"))
        return new NextResponse("Forbidden", { status: 403 });
    let path = "/admin/awards";
    try {
        const form = await request.formData(), action = form.get("action");
        if (action === "create") {
            const award = id(form.get("awardId"));
            path = `/admin/awards/${award}`;
            const batch = await createAwardBatch(actor.id, award, form.get("kind") as "regular" | "remint");
            return awardRedirect(`${path}/batches/${batch.id}`, "saved");
        }
        const batch = id(form.get("batchId"));
        const parent = await pool.query("SELECT award_id FROM award_batches WHERE id=$1", [batch]);
        if (!parent.rowCount)
            return new NextResponse("Not found", { status: 404 });
        path = `/admin/awards/${parent.rows[0].award_id}/batches/${batch}`;
        if (action === "snapshot")
            await snapshotAwardAudience(actor.id, batch, {
                city: String(form.get("city") || ""), interests: form.getAll("interests").map(String), conditions: form.getAll("conditions") as AudienceCondition[],
                membership: String(form.get("membership") || ""), verification: String(form.get("verification") || ""),
            });
        else if (action === "add")
            await addAwardCandidate(actor.id, batch, id(form.get("participantId")));
        else if (action === "edit")
            await editAwardCandidate(actor.id, batch, id(form.get("candidateId")), { status: form.get("status"), reason: form.get("reason"), personalAddress: form.get("personalAddress") });
        else if (action === "finalize") {
            if (form.get("confirm") !== "on")
                throw new AwardValidationError("Confirm finalization");
            await finalizeAwardBatch(actor.id, batch);
        }
        else
            throw new AwardValidationError("Invalid action");
        return awardRedirect(path, "saved");
    }
    catch (error) {
        return awardHttpError(error, path);
    }
}
