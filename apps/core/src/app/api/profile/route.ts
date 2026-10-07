import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { DisplayNameValidationError, updateParticipantDisplayName } from "@/lib/profile";
import { ProfileAboutValidationError, saveProfile } from "@/lib/profile-about";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

function profileRedirect(status: string, rewardId?: string) {
  const url = new URL("/profile", appBaseUrl());
  url.searchParams.set("profile_update", status);
  if (rewardId) url.searchParams.set("onboarding_reward", rewardId);
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
  const residenceFields = ["residence_name", "residence_type", "residence_country"] as const;
  const residence = residenceFields.some((field) => formData.has(field)) ? {
    name: formData.get("residence_name"),
    type: formData.get("residence_type"),
    country: formData.get("residence_country"),
  } : undefined;

  try {
    if (bio === null && visibility === null) {
      const result = await updateParticipantDisplayName(participant.id, formData.get("display_name"));
      return profileRedirect(result.changed ? "updated" : "unchanged");
    }
    const result = await saveProfile(participant.id, formData.get("display_name"), bio, visibility, residence);
    // The checkbox is only rendered for newcomers; its marker tells an unchecked box from an absent one.
    if (formData.get("announce_in_forum_present") === "1") {
      const [{ setForumAnnouncementWithDatabase }, { pool }] = await Promise.all([import("../../../lib/newcomer-announcement"), import("../../../lib/db")]);
      await setForumAnnouncementWithDatabase(pool, participant.id, formData.get("announce_in_forum") === "on");
    }
    await (await import("../../../lib/guardian-forum-actions")).afterProfileChanged(participant.id);
    return profileRedirect(result.changed ? "updated" : "unchanged", result.reward?.id);
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
