import { describe, expect, it } from "vitest";
import {
  updateProfileInterestWithDatabase,
  type ProfileAboutDatabase,
} from "./profile-about";
import { verificationConfirmationLabel } from "./verification";

const OWNER = "11111111-1111-4111-8111-111111111111";
const INTEREST = "22222222-2222-4222-8222-222222222222";

function fakeInterestDatabase({ duplicate = false, found = true } = {}) {
  const queries: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const query = async (sql: string, values?: unknown[]) => {
    queries.push({ sql, values });
    if (sql.includes("SELECT 1 FROM participant_interests")) {
      return { rowCount: duplicate ? 1 : 0, rows: duplicate ? [{ id: INTEREST }] : [] };
    }
    if (sql.includes("UPDATE participant_interests")) {
      return { rowCount: found ? 1 : 0, rows: found ? [{ id: INTEREST }] : [] };
    }
    return { rowCount: 0, rows: [] };
  };
  const client = { query, release: () => {} };
  const database: ProfileAboutDatabase = { connect: async () => client, query };
  return { database, queries };
}

describe("profile interest editing", () => {
  it("updates the owner's existing interest in place, keeping its ID", async () => {
    const { database, queries } = fakeInterestDatabase();
    await updateProfileInterestWithDatabase(database, OWNER, INTEREST, "История", "private");

    const updated = queries.find(({ sql }) => sql.includes("UPDATE participant_interests"));
    expect(updated?.sql).toContain("id = $1::uuid AND participant_id = $2::uuid");
    expect(updated?.values).toEqual([INTEREST, OWNER, "История", "история", "private"]);
    expect(queries.some(({ sql }) => sql.includes("participant.interest_saved"))).toBe(false);
    expect(queries.some(({ sql, values }) => sql.includes("INSERT INTO events") && values?.[0] === "participant.interest_saved")).toBe(true);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("rejects collisions without overwriting another interest", async () => {
    const { database, queries } = fakeInterestDatabase({ duplicate: true });
    await expect(updateProfileInterestWithDatabase(database, OWNER, INTEREST, "История", "public"))
      .rejects.toThrow("Interest already exists");
    expect(queries.some(({ sql }) => sql.includes("UPDATE participant_interests"))).toBe(false);
    expect(queries.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("rejects edits outside the participant's interest list", async () => {
    const { database, queries } = fakeInterestDatabase({ found: false });
    await expect(updateProfileInterestWithDatabase(database, OWNER, INTEREST, "История", "members"))
      .rejects.toThrow("Interest not found");
    expect(queries.at(-1)?.sql).toBe("ROLLBACK");
  });
});

describe("verification confirmation counter", () => {
  it("uses Russian plural forms, including 11–14", () => {
    expect([0, 1, 2, 5, 11, 14, 21, 24].map(verificationConfirmationLabel)).toEqual([
      "0 подтверждений",
      "1 подтверждение",
      "2 подтверждения",
      "5 подтверждений",
      "11 подтверждений",
      "14 подтверждений",
      "21 подтверждение",
      "24 подтверждения",
    ]);
  });
});
