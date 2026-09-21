import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import {
  addProfileInterest,
  addProfileSignal,
  archiveProfileSignal,
  ProfileAboutValidationError,
  removeProfileInterest,
  updateProfileBio,
} from "@/lib/profile-about";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

function profileRedirect(status: string) {
  const url = new URL("/profile", appBaseUrl());
  url.searchParams.set("about_update", status);
  return NextResponse.redirect(url, 303);
}

function requiredId(value: FormDataEntryValue | null): string {
  const id = String(value ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new ProfileAboutValidationError("Invalid id");
  }
  return id;
}

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) {
    return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  }

  const formData = await request.formData();
  const action = formData.get("action");

  try {
    if (action === "update_bio") {
      await updateProfileBio(
        participant.id,
        formData.get("bio"),
        formData.get("visibility"),
      );
    } else if (action === "add_interest") {
      await addProfileInterest(
        participant.id,
        formData.get("label"),
        formData.get("visibility"),
      );
    } else if (action === "remove_interest") {
      await removeProfileInterest(participant.id, requiredId(formData.get("interest_id")));
    } else if (action === "add_signal") {
      await addProfileSignal(
        participant.id,
        formData.get("kind"),
        formData.get("body"),
        formData.get("visibility"),
      );
    } else if (action === "archive_signal") {
      await archiveProfileSignal(participant.id, requiredId(formData.get("signal_id")));
    } else {
      return profileRedirect("invalid");
    }

    return profileRedirect("updated");
  } catch (error) {
    if (error instanceof ProfileAboutValidationError) {
      return profileRedirect("invalid");
    }
    throw error;
  }
}
