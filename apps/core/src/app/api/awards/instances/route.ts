import { NextRequest, NextResponse } from "next/server";
import { getCurrentParticipant } from "@/lib/session";
import { actOnAwardInstance, setAwardVisibility, id, AwardValidationError, AwardAccessError, AwardNotFoundError, AwardTransitionError } from "@/lib/awards";
import { awardRequestForbidden, awardRedirect, awardHttpError } from "@/lib/award-http";
export async function POST(request: NextRequest) {
    const json = request.headers.get("accept")?.includes("application/json");
    if (awardRequestForbidden(request))
        return json ? NextResponse.json({ error: "forbidden" }, { status: 403 }) : new NextResponse("Forbidden", { status: 403 });
    const actor = await getCurrentParticipant();
    if (!actor)
        return json ? NextResponse.json({ error: "unauthorized" }, { status: 401 }) : new NextResponse("Unauthorized", { status: 401 });
    let path = "/profile";
    try {
        const form = await request.formData(), instance = id(form.get("instanceId")), action = form.get("action");
        path = form.get("returnTo") === "profile" ? "/profile" : `/award-offers/${instance}`;
        let result;
        if (action === "visibility")
            result = await setAwardVisibility(actor.id, instance, { showInPublicList: form.get("showInPublicList") === "on", showNextToName: form.get("showNextToName") === "on" });
        else {
            if (action !== "accept" && action !== "decline" && action !== "reject")
                throw new AwardValidationError("Invalid action");
            if (action === "reject" && form.get("confirm") !== "on")
                throw new AwardValidationError("Confirm irreversible rejection");
            result = await actOnAwardInstance(actor.id, instance, action);
        }
        if (json) return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
        return awardRedirect(path, "saved");
    }
    catch (error) {
        if (json) {
            if (error instanceof AwardAccessError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
            if (error instanceof AwardNotFoundError) return NextResponse.json({ error: "not_found" }, { status: 404 });
            if (error instanceof AwardTransitionError) return NextResponse.json({ error: "state" }, { status: 409 });
            if (error instanceof AwardValidationError) return NextResponse.json({ error: "invalid" }, { status: 400 });
        }
        return awardHttpError(error, path);
    }
}
