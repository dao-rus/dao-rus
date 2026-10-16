import { describe, expect, it } from "vitest";
import { extractReceptionProfile } from "./reception-profile-extraction";

describe("reception profile extraction", () => {
  it("extracts only explicit Russian profile phrases", () => {
    expect(extractReceptionProfile("Мне 34 года, живу в Казани. Работаю инженером. Образование: высшее. Семейное положение: женат."))
      .toEqual({ age: 34, city: "Казани", occupation: "инженером", education: "высшее", familyStatus: "женат" });
  });

  it("does not choose between ambiguous values", () => {
    expect(extractReceptionProfile("Мне 34 или 35 лет, город: Казань, город: Москва"))
      .toBeNull();
  });

  it("ignores unlabelled prose", () => {
    expect(extractReceptionProfile("Привет, рад познакомиться. Люблю историю и музыку."))
      .toBeNull();
  });

  it("accepts an explicitly labelled age without requiring a unit", () => {
    expect(extractReceptionProfile("Меня зовут Иван, возраст 51, живу в Пензе, автослесарь"))
      .toMatchObject({ age: 51, city: "Пензе" });
  });

  it.each(["46 лет, Самара, программист", "46, Самара, программист"]) (
    "extracts the explicit three-part positional format: %s", (text) => {
      expect(extractReceptionProfile(text)).toEqual({
        age: 46, city: "Самара", occupation: "программист", education: null, familyStatus: null,
      });
    });

  it.each([
    "46 лет, Самара",
    "46 лет, Самара, программист, инженер",
    "46 или 47 лет, Самара, программист",
    "46 лет, , программист",
    "146 лет, Самара, программист",
  ])("does not apply the positional format to an ambiguous or invalid message: %s", (text) => {
    const result = extractReceptionProfile(text);
    expect(result?.city).not.toBe("Самара");
    expect(result?.occupation).not.toBe("программист");
  });
});
