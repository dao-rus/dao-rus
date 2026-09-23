import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { DisplayNameValidationError, updateParticipantDisplayName } from "@/lib/profile";
import { ProfileAboutValidationError, saveProfile } from "@/lib/profile-about";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

function profileRedirect(status: string) {
  const url = new URL("/profile", appBaseUrl());
  url.searchParams.set("profile_update", status);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) {
    return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  }

  const formData = await request.formData();
  const bio = formData.get("bio");
  const visibility = formData.get("visibility");

  try {
    const result = bio === null && visibility === null
      ? await updateParticipantDisplayName(participant.id, formData.get("display_name"))
      : await saveProfile(participant.id, formData.get("display_name"), bio, visibility);
    return profileRedirect(result.changed ? "updated" : "unchanged");
  } catch (error) {
    if (error instanceof DisplayNameValidationError) {
      return profileRedirect("empty_name");
    }
    if (error instanceof ProfileAboutValidationError) {
      return profileRedirect("invalid");
    }
    throw error;
  }
}
