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
});
