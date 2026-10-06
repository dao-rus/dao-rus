import { SignalValidationError, normalizeSignalDescription, normalizeSignalLabel, normalizeSignalTypeKey, type NetworkSignalSearch } from "./signals";

export type AngelOperation = "compose_signal" | "search_exchange";
export type AngelComposeRequest = { text: string };
export type AngelSearchRequest = { text: string };
export type AngelSignalTypeOption = { key: string; title: string; description?: string; example?: string };
export type AngelComposeResult = { operation: "compose_signal"; typeKey: string; label: string; description: string | null };
export type AngelSearchIntent = { operation: "search_exchange"; typeKeys: string[]; terms: string[] };
export type AngelOutOfScope = { operation: "out_of_scope" };
export type AngelComposeInterpretation = AngelComposeResult | AngelOutOfScope;
export type AngelSearchInterpretation = AngelSearchIntent | AngelOutOfScope;
export type AngelProvider = {
  compose(input: AngelComposeRequest & { types: AngelSignalTypeOption[] }): Promise<unknown>;
  search(input: AngelSearchRequest & { types: AngelSignalTypeOption[] }): Promise<unknown>;
};
export type AngelScopeDenial = { allowed: false; reason: "out_of_scope" | "suspicious_prompt" };

const MAX_TEXT_LENGTH = 4000;
const MAX_TYPE_KEYS = 5;
const MAX_TERMS = 8;
// Match explicit instructions to Angel, never topic words (SQL, Linux, admin,
// tokens can all describe a legitimate skill or need). Ambiguity goes to the
// bounded model interpretation, which can only return an intent or out_of_scope.
const suspicious = /(?:\bignore\s+(?:all\s+)?(?:previous|system)\s+instructions|\b(?:bypass|override)\s+(?:the\s+)?(?:restrictions|permissions|rules)|\b(?:assume|pretend)\s+(?:that\s+)?you\s+(?:have\s+(?:the\s+)?admin(?:istrator)?\s+(?:rights|permissions)|are\s+(?:an?\s+)?admin(?:istrator)?\b)|игнорируй\s+(?:все\s+)?(?:системные|предыдущие)\s+инструкции|(?:обойди|отмени)\s+(?:ограничения|правила|проверки)|(?:считай|представь)[^.!?\n]{0,60}(?:права|правами)\s*(?:admin|администратор))/i;
const outOfScope = /^\s*(?:(?:please|пожалуйста)[,\s]+)?(?:select\s+.+\s+from\b|(?:insert\s+into|update\s+\S+\s+set|delete\s+from|drop\s+table)\b|(?:write|generate)\s+(?:an?\s+)?(?:article|essay)\b|(?:напиши|написать)\s+(?:статью|участнику)|(?:начисли|начислить)\s+(?:мне\s+)?(?:токен|дарус)|(?:mint|grant)\s+(?:me\s+)?tokens\b|(?:выполни|выполнить)\s+(?:команд|sql)|(?:execute|run)\s+(?:sql|a?\s*command)\b|(?:покажи|покажите|показать)\s+(?:всех\s+)?(?:администратор|скрыт\S*\s+(?:данн\S*|сигнал\S*|signals?))|show\s+(?:me\s+)?(?:hidden\s+(?:data|signals?)|(?:all\s+)?administrators)\b)/i;

export class AngelValidationError extends Error {
  constructor(message = "Invalid Angel result") { super(message); this.name = "AngelValidationError"; }
}

export function normalizeAngelText(value: unknown): string {
  if (typeof value !== "string") throw new AngelValidationError("Angel text must be text");
  const text = value.trim();
  if (!text || text.length > MAX_TEXT_LENGTH) throw new AngelValidationError("Angel text is invalid");
  return text;
}

export function angelScopeGate(value: unknown): AngelScopeDenial | null {
  const text = typeof value === "string" ? value : "";
  if (suspicious.test(text)) return { allowed: false, reason: "suspicious_prompt" };
  if (outOfScope.test(text)) return { allowed: false, reason: "out_of_scope" };
  return null;
}

function exactObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AngelValidationError();
  const object = value as Record<string, unknown>;
  if (Object.keys(object).length !== keys.length || keys.some((key) => !(key in object))) throw new AngelValidationError();
  return object;
}

export function validateAngelComposeResult(value: unknown, types: AngelSignalTypeOption[]): AngelComposeInterpretation {
  if (isOutOfScope(value)) return { operation: "out_of_scope" };
  const object = exactObject(value, ["operation", "typeKey", "label", "description"]);
  if (object.operation !== "compose_signal") throw new AngelValidationError();
  const typeKey = validateModelField(() => normalizeSignalTypeKey(object.typeKey));
  if (!types.some((type) => type.key === typeKey)) throw new AngelValidationError("Unknown or disabled signal type");
  return validateModelField(() => {
    if (typeof object.label !== "string" || (object.description !== null && typeof object.description !== "string")) throw new AngelValidationError();
    return { operation: "compose_signal", typeKey, label: normalizeSignalLabel(object.label),
      description: normalizeSignalDescription(object.description) };
  });
}

// Only synchronous validation of model fields crosses this boundary. Provider,
// database and programming failures are handled separately by the caller.
function validateModelField<T>(validate: () => T): T {
  try { return validate(); } catch (error) {
    if (error instanceof SignalValidationError || error instanceof AngelValidationError) throw new AngelValidationError();
    throw error;
  }
}

function isOutOfScope(value: unknown): value is AngelOutOfScope {
  if (value && typeof value === "object" && "operation" in value && value.operation === "out_of_scope") {
    exactObject(value, ["operation"]);
    return true;
  }
  return false;
}

export function validateAngelProviderEnvelope(value: unknown, operation: "compose" | "search", types: AngelSignalTypeOption[]) {
  const envelope = exactObject(value, ["result"]);
  return operation === "compose" ? validateAngelComposeResult(envelope.result, types) : validateAngelSearchIntent(envelope.result, types);
}

function normalizeIntentArray(value: unknown, min: number, max: number, item: (entry: unknown) => string): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new AngelValidationError();
  const normalized = value.map(item);
  if (new Set(normalized).size !== normalized.length) throw new AngelValidationError();
  return normalized;
}

export function validateAngelSearchIntent(value: unknown, types: AngelSignalTypeOption[]): AngelSearchInterpretation {
  if (isOutOfScope(value)) return { operation: "out_of_scope" };
  const object = exactObject(value, ["operation", "typeKeys", "terms"]);
  if (object.operation !== "search_exchange") throw new AngelValidationError();
  const typeKeys = validateModelField(() => normalizeIntentArray(object.typeKeys, 0, MAX_TYPE_KEYS, normalizeSignalTypeKey));
  if (typeKeys.some((key) => !types.some((type) => type.key === key))) throw new AngelValidationError("Unknown or disabled signal type");
  const terms = normalizeIntentArray(object.terms, 1, MAX_TERMS, (value) => {
    if (typeof value !== "string") throw new AngelValidationError();
    const term = value.trim();
    if (!term || term.length > 120) throw new AngelValidationError();
    return term;
  });
  return { operation: "search_exchange", typeKeys, terms };
}

export async function composeWithAngel(provider: AngelProvider, input: AngelComposeRequest, types: AngelSignalTypeOption[]) {
  const text = normalizeAngelText(input.text);
  const gate = angelScopeGate(text);
  if (gate) return gate;
  return validateAngelComposeResult(await provider.compose({ text, types }), types);
}

export async function interpretAngelSearch(provider: AngelProvider, input: AngelSearchRequest, types: AngelSignalTypeOption[]): Promise<AngelSearchInterpretation | AngelScopeDenial> {
  const text = normalizeAngelText(input.text);
  const gate = angelScopeGate(text);
  if (gate) return gate;
  return validateAngelSearchIntent(await provider.search({ text, types }), types);
}

export function searchFromIntent(intent: AngelSearchIntent): NetworkSignalSearch {
  return { typeKeys: intent.typeKeys, terms: intent.terms };
}
