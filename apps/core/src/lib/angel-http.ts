import { NextResponse } from "next/server";
import { AngelValidationError, type AngelOperation, type AngelScopeDenial, type AngelOutOfScope } from "./angel";
import { AngelProviderError } from "./angel-openai";
import { recordAngelRisk } from "./angel-audit";

export function angelErrorResponse(code: string) {
  return NextResponse.json({ error: code }, { status: code === "rate_limit" ? 429 : 400 });
}

export async function angelDenialResponse(participantId: string, operation: AngelOperation, denial: AngelScopeDenial | AngelOutOfScope) {
  const reason = "reason" in denial ? denial.reason : "out_of_scope";
  await recordAngelRisk(participantId, reason, operation);
  return angelErrorResponse(reason);
}

export async function angelFailureResponse(error: unknown, participantId: string, operation: AngelOperation) {
  if (error instanceof AngelValidationError || (error instanceof AngelProviderError && error.kind === "invalid_response")) {
    await recordAngelRisk(participantId, "invalid_model_output", operation);
    return angelErrorResponse("invalid");
  }
  if (error instanceof AngelProviderError) {
    await recordAngelRisk(participantId, "provider_failure", operation);
    return angelErrorResponse("provider_failure");
  }
  throw error;
}
