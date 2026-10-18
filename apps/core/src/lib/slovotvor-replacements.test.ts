import { describe, expect, it } from "vitest";
import { normalizeReplacementSource, SlovotvorReplacementError } from "./slovotvor-replacements";

describe("Slovotvor replacement requests", () => {
  it("trims source words while keeping е and ё distinct", () => {
    expect(normalizeReplacementSource("  е  ")).toBe("е");
    expect(normalizeReplacementSource("  ё  ")).toBe("ё");
  });

  it("rejects empty and overlong source words", () => {
    expect(() => normalizeReplacementSource("   ")).toThrowError(new SlovotvorReplacementError("required"));
    expect(() => normalizeReplacementSource("а".repeat(121))).toThrowError(new SlovotvorReplacementError("too_long"));
  });
});
