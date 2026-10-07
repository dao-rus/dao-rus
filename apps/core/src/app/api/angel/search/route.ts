import { NextRequest, NextResponse } from "next/server";
import { getCurrentParticipant } from "../../../../lib/session";
import { readInterfaceTexts } from "../../../../lib/interface-texts";
import { listSignalTypes, searchNetworkSignals } from "../../../../lib/signals";
import { signalBadge, signalHref, signalTypePresentation } from "../../../../lib/signal-presentation";
import { AngelValidationError, angelScopeGate, interpretAngelSearch, normalizeAngelText, searchFromIntent } from "../../../../lib/angel";
import { getAngelProvider } from "../../../../lib/angel-openai";
import { allowAngelRequest } from "../../../../lib/angel-audit";
import { angelErrorResponse as safeError, angelDenialResponse, angelFailureResponse } from "../../../../lib/angel-http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!await allowAngelRequest(participant.id, "search_exchange")) return safeError("rate_limit");
  const body = await request.json().catch(() => null) as { text?: unknown } | null;
  if (!body) return safeError("invalid");
  let text: string;
  try { text = normalizeAngelText(body.text); } catch (error) {
    if (error instanceof AngelValidationError) return safeError("invalid");
    throw error;
  }
  const gate = angelScopeGate(text);
  if (gate) return angelDenialResponse(participant.id, "search_exchange", gate);
  const [catalog, { values: texts }] = await Promise.all([listSignalTypes(), readInterfaceTexts()]);
  const types = catalog.filter((type) => type.enabled).map((type) => {
    const presentation = signalTypePresentation(type, texts);
    return { key: type.key, title: presentation.name, description: presentation.description, example: presentation.example || undefined };
  });
  try {
    const intent = await interpretAngelSearch(getAngelProvider(), { text }, types);
    if ("reason" in intent || intent.operation === "out_of_scope") return angelDenialResponse(participant.id, "search_exchange", intent);
    const results = await searchNetworkSignals(participant.id, searchFromIntent(intent));
    return NextResponse.json({ results: results.map((signal) => ({
      signalId: signal.id, typeKey: signal.typeKey,
      typeTitle: signalTypePresentation(catalog.find((type) => type.key === signal.typeKey)!, texts).name,
      label: signal.label, description: signal.description,
      owner: signal.author ? { id: signal.author.id, displayName: signal.author.name } : null,
      href: signalHref(signal.id), badge: signalBadge(signal.visibility, texts) ?? null,
    })) });
  } catch (error) {
    return angelFailureResponse(error, participant.id, "search_exchange");
  }
}
