import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl, hasPrototypeAdminAccess } from "@/lib/config";
import {
  ParticipantRegistryIntegrityError,
  ParticipantRegistryNotFoundError,
  ParticipantRegistryValidationError,
} from "@/lib/participant-registry";
import { repairMembershipBinding } from "@/lib/membership-binding-repair";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

function repairRedirect(status: string) {
  const url = new URL("/admin/participants", appBaseUrl());
  url.searchParams.set("registry_repair", status);
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
  try {
    const result = await repairMembershipBinding(
      participant.id,
      formData.get("telegram_user_id"),
    );
    return repairRedirect(result.repaired ? "repaired" : "unchanged");
  } catch (error) {
    if (error instanceof ParticipantRegistryValidationError) {
      return repairRedirect("invalid");
    }
    if (error instanceof ParticipantRegistryNotFoundError) {
      return repairRedirect("not_found");
    }
    if (error instanceof ParticipantRegistryIntegrityError) {
      return repairRedirect("conflict");
    }
    throw error;
  }
}
