import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "../../../../lib/config";
import { getCurrentParticipant } from "../../../../lib/session";
import { SignalValidationError, setSignalExternalShare } from "../../../../lib/signals";
import { SignalReactionUnavailableError, setSignalReaction } from "../../../../lib/signal-reactions";
import { signalHref } from "../../../../lib/signal-presentation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(appBaseUrl()).origin) return new NextResponse("Forbidden", { status: 403 });
  const participant = await getCurrentParticipant();
  if (!participant) return new NextResponse("Unauthorized", { status: 401 });
  const form = await request.formData();
  const id = form.get("signal_id");
  const action = form.get("action");
  if (typeof id !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    if (action === "react_add" || action === "react_remove") {
      await setSignalReaction(participant.id, id, action === "react_add");
    } else if (action === "share_enable" || action === "share_disable") {
      if (action === "share_enable" && form.get("confirm_external_share") !== "yes") {
        return new NextResponse("Confirmation required", { status: 400 });
      }
      await setSignalExternalShare(participant.id, id, action === "share_enable");
    } else {
      return new NextResponse("Invalid action", { status: 400 });
    }
  } catch (error) {
    if (error instanceof SignalValidationError || error instanceof SignalReactionUnavailableError) {
      return new NextResponse("Not found", { status: 404 });
    }
    throw error;
  }
  return NextResponse.redirect(new URL(signalHref(id), appBaseUrl()), 303);
}
