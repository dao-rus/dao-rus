import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "../../../../lib/config";
import { getCurrentParticipant } from "../../../../lib/session";
import { SignalValidationError, countSignalView, setSignalHidden } from "../../../../lib/signals";
import { SignalReactionUnavailableError, setSignalReaction } from "../../../../lib/signal-reactions";
import { signalHref } from "../../../../lib/signal-presentation";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(appBaseUrl()).origin) return new NextResponse("Forbidden", { status: 403 });
  const participant = await getCurrentParticipant();
  const form = await request.formData();
  const id = form.get("signal_id");
  const action = form.get("action");
  // A view is the only action open to guests, and only for a publicly readable record.
  // The answer never says whether the record exists or was counted.
  if (action === "view") {
    await countSignalView(participant?.id ?? null, id);
    return new NextResponse(null, { status: 204 });
  }
  if (!participant) return new NextResponse("Unauthorized", { status: 401 });
  if (typeof id !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (action === "hide" || action === "unhide") {
    const signal = await setSignalHidden(participant.id, id, action === "hide");
    if (action === "hide" && !signal) return new NextResponse("Not found", { status: 404 });
    const url = new URL("/exchange", appBaseUrl());
    if (action === "unhide") url.searchParams.set("hidden", "1");
    else url.searchParams.set("type", signal!.typeKey);
    return NextResponse.redirect(url, 303);
  }
  try {
    if (action === "react_add" || action === "react_remove") {
      await setSignalReaction(participant.id, id, action === "react_add");
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
