import { NextRequest, NextResponse } from "next/server";
import { getCurrentParticipant } from "../../../../lib/session";
import { readInterfaceTexts } from "../../../../lib/interface-texts";
import { listSignalTypes } from "../../../../lib/signals";
import { signalTypePresentation } from "../../../../lib/signal-presentation";
import { AngelValidationError, angelScopeGate, composeWithAngel, normalizeAngelText } from "../../../../lib/angel";
import { AngelProviderError, getAngelProvider } from "../../../../lib/angel-openai";
import { allowAngelRequest, recordAngelRisk } from "../../../../lib/angel-audit";

export const runtime = "nodejs";
function safeError(code: string) { return NextResponse.json({ error: code }, { status: code === "rate_limit" ? 429 : 400 }); }

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { text?: unknown } | null;
  if (!body) return safeError("invalid");
  const [catalog, { values: texts }] = await Promise.all([listSignalTypes(), readInterfaceTexts()]);
  const types = catalog.filter((type) => type.enabled).map((type) => {
    const presentation = signalTypePresentation(type, texts);
    return { key: type.key, title: presentation.name, description: presentation.description, example: presentation.example || undefined };
  });
  try {
    const text = normalizeAngelText(body.text);
    const gate = angelScopeGate(text);
    if (gate) {
      await recordAngelRisk(participant.id, gate.reason, "compose_signal");
      return safeError(gate.reason);
    }
    if (!await allowAngelRequest(participant.id, "compose_signal")) return safeError("rate_limit");
    const result = await composeWithAngel(getAngelProvider(), { text }, types);
    return NextResponse.json({ proposal: result });
  } catch (error) {
    if (error instanceof AngelProviderError) { await recordAngelRisk(participant.id, "provider_failure", "compose_signal"); return safeError("provider_failure"); }
    if (error instanceof AngelValidationError) { await recordAngelRisk(participant.id, "invalid_model_output", "compose_signal"); return safeError("invalid"); }
    throw error;
  }
}
