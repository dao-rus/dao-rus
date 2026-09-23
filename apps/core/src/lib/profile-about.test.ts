import { describe, expect, it } from "vitest";
import {
  normalizeInterest,
  normalizeProfileBio,
  normalizeProfileVisibility,
  normalizeSignalBody,
  normalizeSignalKind,
  ProfileAboutValidationError,
  saveProfileWithDatabase,
  type ProfileAboutDatabase,
  type ProfileAboutDatabaseClient,
} from "./profile-about";
import { DisplayNameValidationError } from "./profile";

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

class ProfileClient implements ProfileAboutDatabaseClient {
  queries: Array<{ text: string; values?: unknown[] }> = [];
  released = false;
  failOnBioEvent = false;

  constructor(private readonly current: { display_name: string; profile_bio: string; profile_bio_visibility: string }) {}

  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });
    if (text.includes("SELECT display_name, profile_bio")) return { rowCount: 1, rows: [this.current] };
    if (this.failOnBioEvent && values?.[0] === "participant.about_updated") throw new Error("event failed");
    return { rowCount: 1, rows: [] };
  }

  release() { this.released = true; }
}

function profileDatabase(client: ProfileClient): ProfileAboutDatabase {
  return {
    async connect() { return client; },
    async query() { return { rowCount: 0, rows: [] }; },
  };
}

describe("saveProfileWithDatabase", () => {
  const participantId = "10000000-0000-4000-8000-000000000001";

  it("saves name, bio and visibility in one transaction with their existing events", async () => {
    const client = new ProfileClient({ display_name: "Анна", profile_bio: "", profile_bio_visibility: "members" });
    const result = await saveProfileWithDatabase(profileDatabase(client), participantId, "Новое имя", "О себе", "public");

    expect(result).toEqual({ changed: true });
    expect(client.queries.map(({ text }) => text).slice(0, 2)).toEqual([
      "BEGIN",
      expect.stringContaining("FOR UPDATE"),
    ]);
    const update = client.queries.find(({ text }) => text.includes("SET display_name = $2"));
    expect(update?.values).toEqual([participantId, "Новое имя", "О себе", "public", true]);
    expect(update?.text).toContain("display_name_chosen_in_core = true");
    expect(client.queries.filter(({ text }) => text.includes("INSERT INTO events"))
      .map(({ values }) => values?.[0])).toEqual(["participant.profile_updated", "participant.about_updated"]);
    expect(client.queries.at(-1)?.text).toBe("COMMIT");
    expect(client.released).toBe(true);
  });

  it("does not emit a name event when only bio changes, but marks the Core name as chosen", async () => {
    const client = new ProfileClient({ display_name: "Анна", profile_bio: "", profile_bio_visibility: "members" });
    await saveProfileWithDatabase(profileDatabase(client), participantId, "Анна", "О себе", "members");
    expect(client.queries.filter(({ text }) => text.includes("INSERT INTO events"))
      .map(({ values }) => values?.[0])).toEqual(["participant.about_updated"]);
    expect(client.queries.find(({ text }) => text.includes("SET display_name = $2"))?.values?.[4]).toBe(true);
  });

  it("rolls back both fields if recording either event fails", async () => {
    const client = new ProfileClient({ display_name: "Анна", profile_bio: "", profile_bio_visibility: "members" });
    client.failOnBioEvent = true;
    await expect(saveProfileWithDatabase(profileDatabase(client), participantId, "Новое имя", "О себе", "members"))
      .rejects.toThrow("event failed");
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
    expect(client.queries.some(({ text }) => text === "COMMIT")).toBe(false);
  });

  it("rejects invalid inputs before opening a transaction", async () => {
    let connected = false;
    const database: ProfileAboutDatabase = {
      async connect() { connected = true; return new ProfileClient({ display_name: "", profile_bio: "", profile_bio_visibility: "members" }); },
      async query() { return { rowCount: 0, rows: [] }; },
    };
    await expect(saveProfileWithDatabase(database, participantId, " ", "О себе", "members"))
      .rejects.toBeInstanceOf(DisplayNameValidationError);
    await expect(saveProfileWithDatabase(database, participantId, "Анна", "О себе", "bad"))
      .rejects.toBeInstanceOf(ProfileAboutValidationError);
    expect(connected).toBe(false);
  });
});
