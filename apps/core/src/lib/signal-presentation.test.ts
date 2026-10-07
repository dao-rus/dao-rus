import { describe, expect, it } from "vitest";
import { interfaceTextFields, type InterfaceTextValues } from "./interface-texts";
import { defaultSignalVisibility, signalHref, signalTypePresentation, signalVisibilityOptions } from "./signal-presentation";

describe("canonical Signal URL", () => {
  it("builds the UUID permalink without type, label slug or owner", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    expect(signalHref(id)).toBe(`/exchange/${id}`);
  });
  it("encodes any unexpected path separators instead of composing another route", () => {
    expect(signalHref("../private")).toBe("/exchange/..%2Fprivate");
  });
});

describe("Signal type navigation symbols", () => {
  const texts = Object.fromEntries(interfaceTextFields.map((field) => [field.key, field.defaultValue])) as InterfaceTextValues;
  it.each([
    ["need", "?", "Нужно"], ["search", "⌕", "Ищу"], ["can", "!", "Могу"],
    ["have", "+", "Есть"], ["want", "♥", "Хочу"], ["know", "i", "Знаю"],
    ["skill", "✓", "Умею"], ["doing", "▶", "Делаю"], ["idea", "✦", "Идея"],
    ["dating", "⚭", "Ближе"],
  ])("presents %s with %s and %s", (key, symbol, navigationName) => {
    expect(signalTypePresentation({ key, displayName: navigationName, enabled: true }, texts))
      .toMatchObject({ symbol, navigationName });
  });
  it("uses a neutral symbol for a future enabled type", () => {
    expect(signalTypePresentation({ key: "future_type", displayName: "Новый тип", enabled: true }, texts))
      .toMatchObject({ symbol: "•", navigationName: "Новый тип" });
  });
});

describe("Closer (dating) visibility policy", () => {
  it("offers only unpublished modes and defaults to waiting for a match", () => {
    expect(signalVisibilityOptions("dating")).toEqual(["match_only", "private"]);
    expect(defaultSignalVisibility("dating")).toBe("match_only");
    expect(defaultSignalVisibility("need")).toBe("members");
  });
});
