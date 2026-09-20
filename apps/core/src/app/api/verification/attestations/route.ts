import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import {
  createVerificationAttestation,
  revokeVerificationAttestation,
  VerificationEligibilityError,
  VerificationNotFoundError,
  VerificationValidationError,
} from "@/lib/verification";

export const runtime = "nodejs";

function profileRedirect(subjectId: string, status: string) {
  const url = new URL(`/profile/${subjectId}`, appBaseUrl());
  url.searchParams.set("verification_action", status);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) {
    return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  }

  const formData = await request.formData();
  const subjectId = String(formData.get("subject_id") ?? "");
  const action = formData.get("action");
  if (!subjectId || (action !== "create" && action !== "revoke")) {
    return profileRedirect(participant.id, "invalid");
  }

  try {
    const result = action === "create"
      ? await createVerificationAttestation(participant.id, subjectId)
      : await revokeVerificationAttestation(participant.id, subjectId);
    return profileRedirect(
      subjectId,
      result.changed
        ? action === "create" ? "created" : "revoked"
        : "unchanged",
    );
  } catch (error) {
    if (error instanceof VerificationValidationError) {
      return error.message === "Self-verification is forbidden"
        ? profileRedirect(subjectId, "self")
        : profileRedirect(participant.id, "invalid");
    }
    if (error instanceof VerificationEligibilityError) {
      return profileRedirect(subjectId, "not_verified");
    }
    if (error instanceof VerificationNotFoundError) {
      return profileRedirect(participant.id, "not_found");
    }
    throw error;
  }
}
