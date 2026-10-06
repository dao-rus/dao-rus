import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "../../../lib/config";
import { getCurrentParticipant } from "../../../lib/session";
import { createSignal, listParticipantSignals, SignalValidationError, updateSignal } from "../../../lib/signals";
import { signalVisibilityOptions } from "../../../lib/signal-presentation";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const json = request.headers.get("accept")?.includes("application/json");
  const participant = await getCurrentParticipant();
  if (!participant) return json ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    : NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  const form = await request.formData();
  const id = form.get("signal_id");
  try {
    let typeKey = form.get("type_key");
    if (id) {
      if (typeof id !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new SignalValidationError("Invalid signal ID");
      const own = (await listParticipantSignals(participant.id, participant.id)).find((signal) => signal.id === id);
      if (!own) throw new SignalValidationError("Signal unavailable");
      typeKey = own.typeKey;
    }
    // Conservative A3 adapter policy, not a new general domain policy engine.
    if (typeof typeKey !== "string" || !signalVisibilityOptions(typeKey).some((value) => value === form.get("visibility"))) {
      throw new SignalValidationError("Invalid visibility");
    }
    const input = { label: form.get("label"), description: form.get("description"), visibility: form.get("visibility") };
    const result = id ? { signal: await updateSignal(participant.id, String(id), input) }
      : await createSignal(participant.id, { ...input, typeKey });
    const url = new URL("/profile", appBaseUrl());
    if ("reward" in result && result.reward) url.searchParams.set("onboarding_reward", result.reward.id);
    url.hash = `signal-${result.signal.typeKey}`;
    return json ? NextResponse.json({ location: url.pathname + url.search + url.hash }) : NextResponse.redirect(url, 303);
  } catch (error) {
    if (!(error instanceof SignalValidationError)) throw error;
    if (json) return NextResponse.json({ error: "Invalid signal" }, { status: 400 });
    const url = new URL("/exchange/new", appBaseUrl());
    url.searchParams.set("error", "invalid");
    if (typeof id === "string") url.searchParams.set("signal", id);
    else if (typeof form.get("type_key") === "string") url.searchParams.set("type", String(form.get("type_key")));
    return NextResponse.redirect(url, 303);
  }
}
