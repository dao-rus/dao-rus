import { NextRequest, NextResponse } from "next/server";
import { getCurrentParticipant } from "../../../../lib/session";
import { readInterfaceTexts } from "../../../../lib/interface-texts";
import { listSignalTypes } from "../../../../lib/signals";
import { signalTypePresentation } from "../../../../lib/signal-presentation";
import { AngelValidationError, angelScopeGate, composeWithAngel, normalizeAngelText } from "../../../../lib/angel";
import { getAngelProvider } from "../../../../lib/angel-openai";
import { allowAngelRequest } from "../../../../lib/angel-audit";
import { angelErrorResponse as safeError, angelDenialResponse, angelFailureResponse } from "../../../../lib/angel-http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!await allowAngelRequest(participant.id, "compose_signal")) return safeError("rate_limit");
  const body = await request.json().catch(() => null) as { text?: unknown } | null;
  if (!body) return safeError("invalid");
  let text: string;
  try { text = normalizeAngelText(body.text); } catch (error) {
    if (error instanceof AngelValidationError) return safeError("invalid");
    throw error;
  }
  const gate = angelScopeGate(text);
  if (gate) return angelDenialResponse(participant.id, "compose_signal", gate);
  const [catalog, { values: texts }] = await Promise.all([listSignalTypes(), readInterfaceTexts()]);
  const types = catalog.filter((type) => type.enabled).map((type) => {
    const presentation = signalTypePresentation(type, texts);
    return { key: type.key, title: presentation.name, description: presentation.description, example: presentation.example || undefined };
  });
  try {
    const result = await composeWithAngel(getAngelProvider(), { text }, types);
    if ("reason" in result || result.operation === "out_of_scope") return angelDenialResponse(participant.id, "compose_signal", result);
    return NextResponse.json({ proposal: result });
  } catch (error) {
    return angelFailureResponse(error, participant.id, "compose_signal");
  }
}
