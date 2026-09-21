import { describe, expect, it } from "vitest";
import {
  normalizeInterest,
  normalizeProfileBio,
  normalizeProfileVisibility,
  normalizeSignalBody,
  normalizeSignalKind,
  ProfileAboutValidationError,
} from "./profile-about";

describe("profile-about validation", () => {
  it("normalizes supported profile values", () => {
    expect(normalizeProfileBio("  Коротко о себе  ")).toBe("Коротко о себе");
    expect(normalizeInterest("  История  ")).toBe("История");
    expect(normalizeSignalBody("  Нужен совет по PostgreSQL  ")).toBe("Нужен совет по PostgreSQL");
    expect(normalizeSignalKind("need")).toBe("need");
    expect(normalizeProfileVisibility("match_only")).toBe("match_only");
  });

  it("rejects empty or unsupported values", () => {
    expect(() => normalizeInterest("   ")).toThrow(ProfileAboutValidationError);
    expect(() => normalizeSignalBody("")).toThrow(ProfileAboutValidationError);
    expect(() => normalizeSignalKind("offer")).toThrow(ProfileAboutValidationError);
    expect(() => normalizeProfileVisibility("everyone")).toThrow(ProfileAboutValidationError);
  });

  it("allows an empty bio so a participant can clear it", () => {
    expect(normalizeProfileBio("   ")).toBe("");
  });
});
