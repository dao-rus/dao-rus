import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { addProfileSignal, ProfileAboutValidationError } from "@/lib/profile-about";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

function needRedirect(param?: "saved" | "error", value?: string) {
  const url = new URL("/need", appBaseUrl());
  if (param && value) url.searchParams.set(param, value);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return needRedirect();

  const form = await request.formData();
  try {
    await addProfileSignal(
      participant.id,
      "need",
      form.get("body"),
      form.get("visibility"),
    );
    return needRedirect("saved", "1");
  } catch (error) {
    if (error instanceof ProfileAboutValidationError) {
      return needRedirect("error", "invalid");
    }
    throw error;
  }
}
