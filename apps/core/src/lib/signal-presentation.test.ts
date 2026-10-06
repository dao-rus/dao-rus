import { describe, expect, it } from "vitest";
import { signalHref } from "./signal-presentation";

describe("canonical Signal URL", () => {
  it("builds the UUID permalink without type, label slug or owner", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    expect(signalHref(id)).toBe(`/exchange/${id}`);
  });
  it("encodes any unexpected path separators instead of composing another route", () => {
    expect(signalHref("../private")).toBe("/exchange/..%2Fprivate");
  });
});
