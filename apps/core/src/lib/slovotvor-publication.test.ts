import { describe, expect, it } from "vitest";
import { transliterateSlovotvorSlug } from "./slovotvor-publication";

describe("Slovotvor slugs", () => {
  it("transliterates Russian words and keeps е distinct from ё", () => {
    expect(transliterateSlovotvorSlug("крайнесрок")).toBe("kraynesrok");
    expect(transliterateSlovotvorSlug("ёлка")).toBe("yolka");
    expect(transliterateSlovotvorSlug("елка")).toBe("elka");
  });
});
