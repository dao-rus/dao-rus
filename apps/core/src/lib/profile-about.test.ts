import { describe, expect, it } from "vitest";
import {
  getProfileAboutWithDatabase,
  getVisibleProfileAboutWithDatabase,
  normalizeInterest,
  normalizeProfileBio,
  normalizeSignalVisibility,
  normalizeResidence,
  normalizeProfileVisibility,
  normalizeSignalBody,
  normalizeSignalKind,
  normalizeSignalLabel,
  normalizeSignalDescription,
  createProfileSignalWithDatabase,
  addProfileSignalWithDatabase,
  listSignalTypesWithDatabase,
  ProfileAboutValidationError,
  residenceLabel,
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
    expect(() => normalizeSignalKind("Offer with spaces")).toThrow(ProfileAboutValidationError);
    expect(() => normalizeProfileVisibility("everyone")).toThrow(ProfileAboutValidationError);
  });

  it("allows an empty bio so a participant can clear it", () => {
    expect(normalizeProfileBio("   ")).toBe("");
  });

  it("allows an omitted residence and normalizes a complete one", () => {
    expect(normalizeResidence({ name: " ", type: "", country: " " })).toBeNull();
    expect(normalizeResidence({ name: "", type: "город", country: "Россия" })).toBeNull();
    expect(normalizeResidence({ name: " Москва ", type: "город", country: "Россия" }))
      .toEqual({ name: "Москва", type: "город", country: "Россия" });
    expect(normalizeResidence({ name: "  Нижний   Новгород  ", type: " город ", country: " Россия " }))
      .toEqual({ name: "Нижний Новгород", type: "город", country: "Россия" });
    expect(() => normalizeResidence({ name: "Казань", type: "", country: "Россия" }))
      .toThrow(ProfileAboutValidationError);
    expect(residenceLabel({ name: "Москва", type: "город", country: "Россия" })).toBe("Москва, Россия");
  });
});

describe("extensible structured signals", () => {
  it("validates key syntax independently of the catalogue and bounds structured content", () => {
    expect(normalizeSignalKind("future_type")).toBe("future_type");
    expect(normalizeSignalLabel("  налоговый юрист  ")).toBe("налоговый юрист");
    expect(normalizeSignalDescription("  Условия и контекст  ")).toBe("Условия и контекст");
    expect(normalizeSignalDescription(undefined)).toBeNull();
    expect(normalizeSignalDescription(" \n ")).toBeNull();
    expect(() => normalizeSignalLabel(" ")).toThrow(ProfileAboutValidationError);
    expect(() => normalizeSignalLabel("я".repeat(121))).toThrow(ProfileAboutValidationError);
    expect(() => normalizeSignalDescription("я".repeat(10001))).toThrow(ProfileAboutValidationError);
    expect(() => normalizeSignalDescription(1)).toThrow(ProfileAboutValidationError);
    for (const kind of ["search", "know", "skill", "doing", "idea", "dating", "future_type"]) {
      expect(() => normalizeSignalVisibility("network_blind", kind)).toThrow(ProfileAboutValidationError);
    }
  });

  it("reads type names as data, including disabled types", async () => {
    expect(await listSignalTypesWithDatabase({ async query() {
      return { rowCount: 1, rows: [{ key: "custom", display_name: "Произвольное название", enabled: false }] };
    } })).toEqual([{ key: "custom", displayName: "Произвольное название", enabled: false }]);
  });

  function databaseForType(enabled: boolean, failAudit = false) {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    let released = false;
    const client: ProfileAboutDatabaseClient = {
      async query(text, values) {
        queries.push({ text, values });
        if (text.includes("FROM signal_types")) return { rowCount: enabled ? 1 : 0, rows: enabled ? [{ key: values?.[0] }] : [] };
        if (text.includes("INSERT INTO profile_signals")) return { rowCount: 1, rows: [{ id: "signal-id" }] };
        if (failAudit && text.includes("INSERT INTO events")) throw new Error("audit failed");
        return { rowCount: 0, rows: [] };
      },
      release() { released = true; },
    };
    return { queries, released: () => released, database: {
      async connect() { return client; }, async query() { return { rowCount: 0, rows: [] }; },
    } };
  }

  it("creates arbitrary catalogue types through the same transaction without a new reward", async () => {
    const test = databaseForType(true);
    expect(await createProfileSignalWithDatabase(test.database, "author", {
      kind: "future_type", label: "Мастерская", description: " По выходным ", visibility: "private",
    })).toEqual({ id: "signal-id" });
    expect(test.queries.find(({ text }) => text.includes("INSERT INTO profile_signals"))?.values)
      .toEqual(["author", "future_type", "Мастерская", "По выходным", "private"]);
    expect(test.queries.filter(({ text }) => text.includes("INSERT INTO events"))[0].values?.[2])
      .toBe(JSON.stringify({ signal_id: "signal-id", kind: "future_type", visibility: "private" }));
    expect(test.queries.some(({ text }) => text.includes("darus_ledger"))).toBe(false);
    expect(test.queries.at(-1)?.text).toBe("COMMIT");
    expect(test.released()).toBe(true);
  });

  it("rejects unknown or disabled catalogue entries before insertion and rolls back", async () => {
    const test = databaseForType(false);
    await expect(createProfileSignalWithDatabase(test.database, "author", {
      kind: "unknown", label: "Текст", visibility: "members",
    })).rejects.toThrow("Unknown or disabled");
    expect(test.queries.some(({ text }) => text.includes("INSERT INTO profile_signals"))).toBe(false);
    expect(test.queries.at(-1)?.text).toBe("ROLLBACK");
    expect(test.released()).toBe(true);
  });

  it("preserves the body-only contract and rolls back signals if audit fails", async () => {
    const test = databaseForType(true, true);
    await expect(addProfileSignalWithDatabase(test.database, "author", "need", " Старый текст ", "network_blind"))
      .rejects.toThrow("audit failed");
    expect(test.queries.find(({ text }) => text.includes("INSERT INTO profile_signals"))?.values)
      .toEqual(["author", "need", "Старый текст", "network_blind"]);
    expect(test.queries.at(-1)?.text).toBe("ROLLBACK");
  });
});

class ProfileClient implements ProfileAboutDatabaseClient {
  queries: Array<{ text: string; values?: unknown[] }> = [];
  released = false;
  failOnBioEvent = false;

  constructor(private readonly current: {
    display_name: string; profile_bio: string; profile_bio_visibility: string;
    residence_name?: string; residence_type?: string; residence_country?: string;
  }) {}

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
    expect(update?.values).toEqual([participantId, "Новое имя", "О себе", "public", true, null, null, null]);
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
    await expect(saveProfileWithDatabase(database, participantId, "Анна", "", "members", {
      name: "Казань", type: "", country: "Россия",
    })).rejects.toBeInstanceOf(ProfileAboutValidationError);
    expect(connected).toBe(false);
  });

  it("saves and clears optional residence atomically without writing its text to events", async () => {
    const current = { display_name: "Анна", profile_bio: "", profile_bio_visibility: "members" };
    const client = new ProfileClient(current);
    const residence = { name: "Казань", type: "город", country: "Россия" };
    expect(await saveProfileWithDatabase(profileDatabase(client), participantId, "Анна", "", "members", residence))
      .toEqual({ changed: true });
    expect(client.queries.find(({ text }) => text.includes("SET display_name = $2"))?.values)
      .toEqual([participantId, "Анна", "", "members", true, "Казань", "город", "Россия"]);
    const events = client.queries.filter(({ text }) => text.includes("INSERT INTO events"));
    expect(events.map(({ values }) => values?.[0])).toEqual(["participant.about_updated"]);
    expect(events[0].values?.[2]).toBe(JSON.stringify({ field: "residence" }));
    // The database trigger owns the atomic award; the adapter reads its result
    // only from this action's transaction for immediate feedback.
    const firstReward = client.queries.find(({ text }) => text.includes("event.payload->>'transaction_id'"));
    expect(firstReward?.values).toEqual([participantId, "residence_first_filled"]);
    expect(client.queries.some(({ text }) => text.includes("INSERT INTO darus_ledger"))).toBe(false);

    const clearClient = new ProfileClient({ ...current,
      residence_name: "Казань", residence_type: "город", residence_country: "Россия",
    });
    expect(await saveProfileWithDatabase(profileDatabase(clearClient), participantId, "Анна", "", "members", {
      name: "", type: "", country: "",
    })).toEqual({ changed: true });
    expect(clearClient.queries.find(({ text }) => text.includes("SET display_name = $2"))?.values?.slice(5))
      .toEqual([null, null, null]);
    expect(clearClient.queries.some(({ text }) => text.includes("INSERT INTO darus_ledger"))).toBe(false);

    const defaultClient = new ProfileClient(current);
    expect(await saveProfileWithDatabase(profileDatabase(defaultClient), participantId, "Анна", "", "members", {
      name: "", type: "город", country: "Россия",
    })).toEqual({ changed: false });
    expect(defaultClient.queries.find(({ text }) => text.includes("SET display_name = $2"))?.values?.slice(5))
      .toEqual([null, null, null]);
  });
});

describe("profile residence reads", () => {
  it("reads the self-authored place and exposes it to a signed-in viewer", async () => {
    const queries: string[] = [];
    const database = { async query(text: string) {
      queries.push(text);
      if (text.includes("FROM participants")) return { rowCount: 1, rows: [{
        profile_bio: "", profile_bio_visibility: "members",
        residence_name: "Казань", residence_type: "город", residence_country: "Россия",
      }] };
      return { rowCount: 0, rows: [] };
    } };
    expect((await getProfileAboutWithDatabase(database, "owner"))?.residence)
      .toEqual({ name: "Казань", type: "город", country: "Россия" });
    expect((await getVisibleProfileAboutWithDatabase(database, "owner", "viewer"))?.residence)
      .toEqual({ name: "Казань", type: "город", country: "Россия" });
    expect(queries.some((text) => text.includes("residence_name, residence_type, residence_country"))).toBe(true);
  });
});

describe("anonymous signal publication boundary", () => {
  it("keeps network-blind and match-only signals out of another participant's profile", async () => {
    const signals = [
      { id: "blind", kind: "need", label: "Анонимно", description: null, legacy_body: true, body: "Анонимно", visibility: "network_blind" },
      { id: "hidden", kind: "need", label: "Скрыто", description: null, legacy_body: true, body: "Скрыто", visibility: "match_only" },
      { id: "member", kind: "need", label: "Участникам", description: null, legacy_body: true, body: "Участникам", visibility: "members" },
    ];
    const queries: string[] = [];
    const database = { async query(text: string) {
      queries.push(text);
      if (text.includes("FROM participants")) return { rowCount: 1, rows: [{
        profile_bio: "", profile_bio_visibility: "members",
      }] };
      if (text.includes("FROM profile_signals")) return {
        rowCount: text.includes("visibility IN ('public', 'members')") ? 1 : 3,
        rows: text.includes("visibility IN ('public', 'members')")
          ? [signals[2]] : signals,
      };
      return { rowCount: 0, rows: [] };
    } };
    const own = await getProfileAboutWithDatabase(database, "author");
    const foreign = await getVisibleProfileAboutWithDatabase(database, "author", "viewer");
    expect(own?.signals.map((signal) => signal.id)).toEqual(["blind", "hidden", "member"]);
    expect(foreign?.signals.map((signal) => signal.id)).toEqual(["member"]);
    expect(foreign?.signals[0]).toMatchObject({ label: "Участникам", description: null, legacyBody: true });
    expect(queries.some((query) => query.includes("visibility IN ('public', 'members')"))).toBe(true);
    expect(normalizeSignalVisibility("network_blind", "need")).toBe("network_blind");
    expect(normalizeSignalVisibility("network_blind", "have")).toBe("network_blind");
    expect(() => normalizeSignalVisibility("network_blind", "want")).toThrow();
    expect(() => normalizeSignalVisibility("network_blind", "can")).toThrow();
  });
});
