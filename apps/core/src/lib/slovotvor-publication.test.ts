import { describe, expect, it } from "vitest";
import { normalizePublicationInput, SlovotvorPublicationError, transliterateSlovotvorSlug } from "./slovotvor-publication";

describe("Slovotvor slugs", () => {
  it("transliterates Russian words and keeps е distinct from ё", () => {
    expect(transliterateSlovotvorSlug("крайнесрок")).toBe("kraynesrok");
    expect(transliterateSlovotvorSlug("ёлка")).toBe("yolka");
    expect(transliterateSlovotvorSlug("елка")).toBe("elka");
  });
});

describe("Slovotvor publication input", () => {
  it.each([
    ["pair", "слово", "замена", "описание"],
    ["word only", "слово", "", ""],
    ["source only", "", "замена", ""],
    ["description only", "", "", "описание"],
  ])("accepts the %s publication form", (_kind, word, source, explanation) => {
    expect(normalizePublicationInput(` ${word} `, ` ${source} `, ` ${explanation} `)).toEqual({
      word: word || null, sourceWord: source || null, explanation: explanation || null,
    });
  });

  it("rejects a publication with only whitespace", () => {
    expect(() => normalizePublicationInput("  ", "\t", " ")).toThrowError(new SlovotvorPublicationError("required"));
  });
});
