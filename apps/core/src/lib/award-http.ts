import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "./config";
import { AwardAccessError, AwardConflictError, AwardNotFoundError, AwardTransitionError, AwardValidationError } from "./awards";
export function awardRequestForbidden(request: NextRequest) {
    const origin = request.headers.get("origin");
    return request.headers.get("sec-fetch-site") === "cross-site" || (!!origin && origin !== new URL(appBaseUrl()).origin);
}
export function awardRedirect(path: string, notice?: string) {
    const url = new URL(path, appBaseUrl());
    if (notice)
        url.searchParams.set("award_update", notice);
    return NextResponse.redirect(url, 303);
}
export function awardHttpError(error: unknown, path: string) {
    if (error instanceof AwardAccessError)
        return new NextResponse("Forbidden", { status: 403 });
    if (error instanceof AwardNotFoundError)
        return new NextResponse("Not found", { status: 404 });
    if (error instanceof AwardConflictError)
        return awardRedirect(path, "conflict");
    if (error instanceof AwardTransitionError)
        return awardRedirect(path, "state");
    if (error instanceof AwardValidationError)
        return awardRedirect(path, "invalid");
    throw error;
}
