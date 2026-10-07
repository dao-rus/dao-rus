import { describe, expect, it } from "vitest";
import { normalizeCloserKeys, type CloserGoal } from "./closer";

const goals: CloserGoal[] = [
  { key: "friend", displayName: "Друг", asksGender: false, enabled: true },
  { key: "relationship", displayName: "Отношения", asksGender: true, enabled: true },
  { key: "old", displayName: "Старая", asksGender: false, enabled: false },
];

describe("Closer match keys from form input", () => {
  it("keeps gender only for goals that ask for it", () => {
    expect(normalizeCloserKeys({ goal: "friend", city: "city", self: "m", seeks: "f" }, goals, true))
      .toEqual({ goalKey: "friend", anyCity: false, selfGender: null, seeksGender: null });
    expect(normalizeCloserKeys({ goal: "relationship", city: "any", self: "", seeks: "any" }, goals, false))
      .toEqual({ goalKey: "relationship", anyCity: true, selfGender: null, seeksGender: "any" });
    expect(normalizeCloserKeys({ goal: "relationship", city: "any", self: "f", seeks: "m" }, goals, false))
      .toMatchObject({ selfGender: "f", seeksGender: "m" });
  });
  it.each([
    [{ goal: "old", city: "any" }, true], [{ goal: "missing", city: "any" }, true], [{ goal: null, city: "any" }, true],
    [{ goal: "friend", city: "Москва" }, true], [{ goal: "friend", city: "city" }, false],
    [{ goal: "relationship", city: "any" }, true], [{ goal: "relationship", city: "any", seeks: "x" }, true],
    [{ goal: "relationship", city: "any", seeks: "m", self: "any" }, true],
  ])("rejects %j", (input, hasResidence) => {
    expect(() => normalizeCloserKeys(input, goals, hasResidence)).toThrow();
  });
});
