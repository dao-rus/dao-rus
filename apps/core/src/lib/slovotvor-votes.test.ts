import { describe, expect, it } from "vitest";
import {
  castSlovotvorVoteWithDatabase,
  getSlovotvorVoteSummary,
} from "./slovotvor";

const wordId = "10000000-0000-4000-8000-000000000001";
const participantId = "20000000-0000-4000-8000-000000000002";

function voteDatabase(initialChoice: string | null = null, wordExists = true) {
  let choice = initialChoice;
  const queries: string[] = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      queries.push(sql);
      if (sql.startsWith("SELECT id FROM slovotvor_words")) return wordExists ? { rows: [{ id: wordId }], rowCount: 1 } : { rows: [], rowCount: 0 };
      if (sql.startsWith("SELECT choice FROM slovotvor_votes")) return { rows: choice ? [{ choice }] : [], rowCount: choice ? 1 : 0 };
      if (sql.startsWith("DELETE FROM slovotvor_votes")) { choice = null; return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("INSERT INTO slovotvor_votes")) { choice = String(values?.[2]); return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  return { database: { connect: async () => client } as any, queries, get choice() { return choice; } };
}

describe("Slovotvor votes", () => {
  it("sets, cancels, and changes one participant's vote", async () => {
    const fixture = voteDatabase();
    await castSlovotvorVoteWithDatabase(fixture.database, wordId, participantId, "better");
    expect(fixture.choice).toBe("better");

    await castSlovotvorVoteWithDatabase(fixture.database, wordId, participantId, "better");
    expect(fixture.choice).toBeNull();

    await castSlovotvorVoteWithDatabase(fixture.database, wordId, participantId, "worse");
    expect(fixture.choice).toBe("worse");
    await castSlovotvorVoteWithDatabase(fixture.database, wordId, participantId, "better");
    expect(fixture.choice).toBe("better");
    expect(fixture.queries.some((sql) => sql.includes("ON CONFLICT (word_id, participant_id)"))).toBe(true);
  });

  it("rejects invalid choices before touching the database", async () => {
    const fixture = voteDatabase();
    await expect(castSlovotvorVoteWithDatabase(fixture.database, wordId, participantId, "maybe"))
      .rejects.toMatchObject({ code: "invalid" });
    expect(fixture.queries).toHaveLength(0);
  });

  it("rejects publications without a new word", async () => {
    const fixture = voteDatabase(null, false);
    await expect(castSlovotvorVoteWithDatabase(fixture.database, wordId, participantId, "better"))
      .rejects.toMatchObject({ code: "missing" });
    expect(fixture.choice).toBeNull();
    expect(fixture.queries.some((sql) => sql.startsWith("INSERT INTO slovotvor_votes"))).toBe(false);
  });

  it("returns counts and the current participant's choice", async () => {
    const database = {
      query: async () => ({ rows: [{ better: 4, worse: 2, own_vote: "better" }], rowCount: 1 }),
    } as any;
    await expect(getSlovotvorVoteSummary(wordId, participantId, database)).resolves.toEqual({ better: 4, worse: 2, ownVote: "better" });
  });
});
