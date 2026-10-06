import { NextRequest, NextResponse } from "next/server";
import { getCurrentParticipant } from "../../../../lib/session";
import { readInterfaceTexts } from "../../../../lib/interface-texts";
import { listSignalTypes, searchNetworkSignals } from "../../../../lib/signals";
import { signalHref, signalTypePresentation } from "../../../../lib/signal-presentation";
import { AngelValidationError, angelScopeGate, interpretAngelSearch, normalizeAngelText, searchFromIntent } from "../../../../lib/angel";
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
      await recordAngelRisk(participant.id, gate.reason, "search_exchange"); return safeError(gate.reason);
    }
    if (!await allowAngelRequest(participant.id, "search_exchange")) return safeError("rate_limit");
    const intent = await interpretAngelSearch(getAngelProvider(), { text }, types);
    if ("reason" in intent) {
      await recordAngelRisk(participant.id, intent.reason, "search_exchange"); return safeError(intent.reason);
    }
    const results = await searchNetworkSignals(participant.id, searchFromIntent(intent));
    return NextResponse.json({ results: results.map((signal) => ({
      signalId: signal.id, typeKey: signal.typeKey,
      typeTitle: signalTypePresentation(catalog.find((type) => type.key === signal.typeKey)!, texts).name,
      label: signal.label, description: signal.description,
      owner: signal.author ? { id: signal.author.id, displayName: signal.author.name } : null,
      href: signalHref(signal.id),
    })) });
  } catch (error) {
    if (error instanceof AngelProviderError) { await recordAngelRisk(participant.id, "provider_failure", "search_exchange"); return safeError("provider_failure"); }
    if (error instanceof AngelValidationError) { await recordAngelRisk(participant.id, "invalid_model_output", "search_exchange"); return safeError("invalid"); }
    throw error;
  }
}
