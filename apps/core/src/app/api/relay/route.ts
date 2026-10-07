import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import {
  cancelRelayEncounter,
  consentRelayReveal,
  createRelayEncounter,
  RelayAccessError,
  RelayValidationError,
  sendRelayMessage,
} from "@/lib/relay";

import { CloserUnavailableError, openCloserDialog } from "../../../lib/closer";
import { notifyCloser } from "../../../lib/closer-notify";

export const runtime = "nodejs";

function redirectTo(path: string) {
  return NextResponse.redirect(new URL(path, appBaseUrl()), 303);
}

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return redirectTo("/");
  const form = await request.formData();
  const action = form.get("action");

  try {
    if (action === "respond") {
      const encounterId = await createRelayEncounter(participant.id, form.get("signal_id"));
      return redirectTo("/relay/" + encounterId);
    }
    if (action === "closer_respond") {
      const dialog = await openCloserDialog(participant.id, form.get("my_signal_id"), form.get("signal_id"));
      if (dialog.notifyParticipantId) await notifyCloser([dialog.notifyParticipantId], "dialog", "/relay/" + dialog.encounterId);
      return redirectTo("/relay/" + dialog.encounterId);
    }
    const encounterId = form.get("encounter_id");
    if (action === "message") {
      await sendRelayMessage(participant.id, encounterId, form.get("body"));
      return redirectTo("/relay/" + encounterId);
    }
    if (action === "consent") {
      await consentRelayReveal(participant.id, encounterId);
      return redirectTo("/relay/" + encounterId);
    }
    if (action === "cancel") {
      await cancelRelayEncounter(participant.id, encounterId);
      return redirectTo("/relay?archive=1");
    }
    return new NextResponse("Invalid relay action", { status: 400 });
  } catch (error) {
    if (error instanceof RelayAccessError || error instanceof CloserUnavailableError) {
      return new NextResponse("Relay interaction is unavailable", { status: 404 });
    }
    if (error instanceof RelayValidationError) {
      return new NextResponse("Invalid relay input", { status: 400 });
    }
    throw error;
  }
}
