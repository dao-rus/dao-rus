import { normalizeSignalDescription, normalizeSignalLabel, normalizeSignalTypeKey, type NetworkSignalSearch } from "./signals";

export type AngelOperation = "compose_signal" | "search_exchange";
export type AngelComposeRequest = { text: string };
export type AngelSearchRequest = { text: string };
export type AngelSignalTypeOption = { key: string; title: string; description?: string; example?: string };
export type AngelComposeResult = { operation: "compose_signal"; typeKey: string; label: string; description: string | null };
export type AngelSearchIntent = { operation: "search_exchange"; typeKeys: string[]; terms: string[] };
export type AngelProvider = {
  compose(input: AngelComposeRequest & { types: AngelSignalTypeOption[] }): Promise<unknown>;
  search(input: AngelSearchRequest & { types: AngelSignalTypeOption[] }): Promise<unknown>;
};
export type AngelScopeDenial = { allowed: false; reason: "out_of_scope" | "suspicious_prompt" };

const MAX_TEXT_LENGTH = 4000;
const MAX_TYPE_KEYS = 5;
const MAX_TERMS = 8;
const suspicious = /(?:ignore\s+(?:all\s+)?(?:previous|system)|system\s+prompt|jailbreak|\b(?:select|insert|update|delete|drop)\b|\bsql\b|\bshell\b|\badmin(?:istrator)?\b|hidden\s+(?:data|signals?)|скрыт\S*\s+(?:данн\S*|сигнал\S*|signals?))/i;
const outOfScope = /(?:write\s+(?:an\s+)?article|написать\s+(?:статью|участнику)|изменить\s+(?:репутац|сигнал)|начислить\s+(?:токен|дарус)|выполнить\s+(?:команд|sql)|покаж(?:и|ите|ать)\s+(?:всех\s+)?администратор)/i;

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

export function validateAngelComposeResult(value: unknown, types: AngelSignalTypeOption[]): AngelComposeResult {
  const object = exactObject(value, ["operation", "typeKey", "label", "description"]);
  if (object.operation !== "compose_signal") throw new AngelValidationError();
  const typeKey = normalizeSignalTypeKey(object.typeKey);
  if (!types.some((type) => type.key === typeKey)) throw new AngelValidationError("Unknown or disabled signal type");
  try {
    return { operation: "compose_signal", typeKey, label: normalizeSignalLabel(object.label),
      description: normalizeSignalDescription(object.description) };
  } catch { throw new AngelValidationError(); }
}

function normalizeIntentArray(value: unknown, min: number, max: number, item: (entry: unknown) => string): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new AngelValidationError();
  const normalized = value.map(item);
  if (new Set(normalized).size !== normalized.length) throw new AngelValidationError();
  return normalized;
}

export function validateAngelSearchIntent(value: unknown, types: AngelSignalTypeOption[]): AngelSearchIntent {
  const object = exactObject(value, ["operation", "typeKeys", "terms"]);
  if (object.operation !== "search_exchange") throw new AngelValidationError();
  const typeKeys = normalizeIntentArray(object.typeKeys, 0, MAX_TYPE_KEYS, normalizeSignalTypeKey);
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

export async function interpretAngelSearch(provider: AngelProvider, input: AngelSearchRequest, types: AngelSignalTypeOption[]): Promise<AngelSearchIntent | AngelScopeDenial> {
  const text = normalizeAngelText(input.text);
  const gate = angelScopeGate(text);
  if (gate) return gate;
  return validateAngelSearchIntent(await provider.search({ text, types }), types);
}

export function searchFromIntent(intent: AngelSearchIntent): NetworkSignalSearch {
  return { typeKeys: intent.typeKeys, terms: intent.terms };
}
