import { describe, expect, it } from "vitest";
import { interfaceTextFields, type InterfaceTextValues } from "./interface-texts";
import { signalAudience, signalBadge, defaultSignalVisibility, signalHref, signalTypePresentation, signalVisibilityOptions } from "./signal-presentation";

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

describe("who can see a record, in three reader-facing words", () => {
  const texts = Object.fromEntries(interfaceTextFields.map((field) => [field.key, field.defaultValue])) as InterfaceTextValues;
  it("maps six visibility modes to three audiences", () => {
    expect((["public", "members", "network_blind", "match_only", "private", "circle"] as const).map(signalAudience))
      .toEqual(["public", "members", "members", "match", null, null]);
  });
  it("puts no note on public records and names private ones only to their author", () => {
    expect(signalBadge("public", texts)).toBeUndefined();
    expect(signalBadge("public", texts, true)).toBeUndefined();
    expect(signalBadge("members", texts)).toBe("Только ДАО");
    expect(signalBadge("network_blind", texts)).toBe("Только ДАО");
    expect(signalBadge("match_only", texts, true)).toBe("Только при совпадении");
    expect(signalBadge("private", texts)).toBeUndefined();
    expect(signalBadge("private", texts, true)).toBe("Только мне");
  });
});
