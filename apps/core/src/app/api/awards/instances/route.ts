import { NextRequest, NextResponse } from "next/server";
import { getCurrentParticipant } from "@/lib/session";
import { actOnAwardInstance, setAwardVisibility, id, AwardValidationError } from "@/lib/awards";
import { awardRequestForbidden, awardRedirect, awardHttpError } from "@/lib/award-http";
export async function POST(request: NextRequest) {
    if (awardRequestForbidden(request))
        return new NextResponse("Forbidden", { status: 403 });
    const actor = await getCurrentParticipant();
    if (!actor)
        return new NextResponse("Unauthorized", { status: 401 });
    let path = "/profile";
    try {
        const form = await request.formData(), instance = id(form.get("instanceId")), action = form.get("action");
        path = form.get("returnTo") === "profile" ? "/profile" : `/award-offers/${instance}`;
        if (action === "visibility")
            await setAwardVisibility(actor.id, instance, { showInPublicList: form.get("showInPublicList") === "on", showNextToName: form.get("showNextToName") === "on" });
        else {
            if (action !== "accept" && action !== "decline" && action !== "reject")
                throw new AwardValidationError("Invalid action");
            if (action === "reject" && form.get("confirm") !== "on")
                throw new AwardValidationError("Confirm irreversible rejection");
            await actOnAwardInstance(actor.id, instance, action);
        }
        return awardRedirect(path, "saved");
    }
    catch (error) {
        return awardHttpError(error, path);
    }
}
