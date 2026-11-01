import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { setCommunicationSignal, type CommunicationAction } from "@/lib/communication-reputation";
import { ReputationValidationError } from "@/lib/reputation";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actions = new Set<CommunicationAction>(["positive", "negative", "revoke"]);

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.redirect(new URL("/", appBaseUrl()), 303);

  const form = await request.formData();
  const subjectId = form.get("subject_id");
  if (typeof subjectId !== "string" || !uuidPattern.test(subjectId)) {
    return new NextResponse("Invalid subject", { status: 400 });
  }

  let status: string;
  const action = form.get("action");
  try {
    if (typeof action !== "string" || !actions.has(action as CommunicationAction)) {
      status = "invalid";
    } else {
      status = await setCommunicationSignal(participant.id, subjectId, action as CommunicationAction);
    }
  } catch (error) {
    if (!(error instanceof ReputationValidationError)) throw error;
    status = error.message === "Cannot rate yourself" || participant.id === subjectId ? "self" : "invalid";
  }

  const url = new URL(`/profile/${subjectId}`, appBaseUrl());
  url.searchParams.set("communication_action", status);
  return NextResponse.redirect(url, 303);
}
