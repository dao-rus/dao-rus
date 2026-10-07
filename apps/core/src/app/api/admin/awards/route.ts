import { NextRequest, NextResponse } from "next/server";
import { getCurrentParticipant } from "@/lib/session";
import { hasAwardCapability } from "@/lib/award-access";
import { establishAward, AwardValidationError } from "@/lib/awards";
import { prepareAwardImages } from "@/lib/award-images";
import { awardRequestForbidden, awardRedirect, awardHttpError } from "@/lib/award-http";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
    if (awardRequestForbidden(request))
        return new NextResponse("Forbidden", { status: 403 });
    const actor = await getCurrentParticipant();
    if (!actor)
        return new NextResponse("Unauthorized", { status: 401 });
    if (!hasAwardCapability(actor.id, "award.establish"))
        return new NextResponse("Forbidden", { status: 403 });
    try {
        const form = await request.formData(), image = form.get("image");
        if (!(image instanceof File))
            throw new AwardValidationError("Image required");
        const award = await establishAward(actor.id, {
            slug: form.get("slug"), name: form.get("name"), imageUrl: "", establishedOn: form.get("establishedOn"),
            description: form.get("description"), criterion: form.get("criterion"), publicAddress: form.get("publicAddress"),
            kind: form.get("kind"), historicalCutoffAt: form.get("historicalCutoffAt") || null, images: await prepareAwardImages(image),
        });
        return awardRedirect(`/admin/awards/${award.id}`, "saved");
    }
    catch (error) {
        return awardHttpError(error, "/admin/awards");
    }
}
