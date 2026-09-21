import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { parseReputationAction, ReputationValidationError, setReputationSignal } from "@/lib/reputation";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.redirect(new URL("/", appBaseUrl()), 303);

  const form = await request.formData();
  const subjectId = form.get("subject_id");
  if (typeof subjectId !== "string" || !uuidPattern.test(subjectId)) {
    return new NextResponse("Invalid subject", { status: 400 });
  }

  let status: string;
  try {
    status = await setReputationSignal(participant.id, subjectId, parseReputationAction(form.get("action")));
  } catch (error) {
    if (!(error instanceof ReputationValidationError)) throw error;
    status = participant.id === subjectId ? "self" : "invalid";
  }
  const url = new URL(`/profile/${subjectId}`, appBaseUrl());
  url.searchParams.set("reputation_action", status);
  return NextResponse.redirect(url, 303);
}
