import { describe, expect, it } from "vitest";
import { validateReceptionForm } from "./reception-applications";

const form = { city: " Москва ", occupation: " Мастер ", age: 35, education: null, familyStatus: null, publishAge: false };
describe("Reception form validation", () => {
  it("trims required fields and accepts omitted or removed age without publication consent", () => {
    expect(validateReceptionForm(form)).toEqual({ ...form, city: "Москва", occupation: "Мастер" });
    expect(validateReceptionForm({ city: "Тверь", occupation: "Мастер", publishAge: false }).age).toBeNull();
    expect(validateReceptionForm({ ...form, age: null }).age).toBeNull();
    expect(validateReceptionForm({ ...form, age: 120, publishAge: true }).publishAge).toBe(true);
  });
  it.each([null, [], {}, { ...form, city: " " }, { ...form, city: 42 },
    { ...form, city: "x".repeat(201) }, { ...form, occupation: "x".repeat(1001) },
    { ...form, occupation: "a\u0000b" }, { ...form, age: "35" }, { ...form, age: 1.5 },
    { ...form, age: 0 }, { ...form, age: 121 }, { ...form, age: null, publishAge: true },
    { ...form, publishAge: "true" }, { city: "A", occupation: "B" },
    { ...form, status: "closed" }, { ...form, participantId: "other" },
  ])("rejects invalid types, bounds, missing consent or unexpected fields: %j", value => {
    expect(() => validateReceptionForm(value)).toThrow("invalid_form");
  });
});
