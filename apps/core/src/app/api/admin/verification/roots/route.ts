import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl, hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import {
  addVerificationRoot,
  VerificationNotFoundError,
  VerificationValidationError,
} from "@/lib/verification";

export const runtime = "nodejs";

function profileRedirect(subjectId: string, status: string) {
  const url = new URL(`/profile/${subjectId}`, appBaseUrl());
  url.searchParams.set("verification_root", status);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) {
    return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  }
  if (!hasPrototypeAdminAccess(participant.id)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const subjectId = String(formData.get("subject_id") ?? "");
  if (!subjectId) return profileRedirect(participant.id, "invalid");

  try {
    const result = await addVerificationRoot(participant.id, subjectId);
    return profileRedirect(subjectId, result.changed ? "added" : "unchanged");
  } catch (error) {
    if (error instanceof VerificationNotFoundError) {
      return profileRedirect(participant.id, "not_found");
    }
    if (error instanceof VerificationValidationError) {
      return profileRedirect(participant.id, "invalid");
    }
    throw error;
  }
}
