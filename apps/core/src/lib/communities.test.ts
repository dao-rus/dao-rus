import { describe, expect, it } from "vitest";
import { communityFromParams, communityKey, createCommunityPostWithDatabase,
  deleteCommunityPostWithDatabase, listCommunitySignalsWithDatabase,
  CommunityMembershipError, type CommunityClient, type CommunityDatabase } from "./communities";

const interest = { type: "interest" as const, interest: "История" };
const residence = { type: "residence" as const,
  residence: { name: "Москва", type: "город", country: "Россия" } };

function database(member: boolean) {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const client: CommunityClient = {
    async query(text, values) {
      queries.push({ text, values });
      if (text.includes("FROM participant_interests") || text.includes("FROM participants WHERE id"))
        return { rowCount: member ? 1 : 0, rows: [] };
      if (text.includes("INSERT INTO community_posts")) return { rowCount: 1, rows: [{ id: "post" }] };
      if (text.includes("UPDATE community_posts")) return { rowCount: 1, rows: [{ id: "post" }] };
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  return { queries, database: { query: client.query, async connect() { return client; } } as CommunityDatabase };
}

describe("community publication", () => {
  it("normalizes each community identity and keeps the complete residence tuple", () => {
    expect(communityFromParams({ interest: " История " })).toEqual(interest);
    expect(communityKey(interest)).toBe("история");
    expect(communityKey(residence)).toBe('["россия","город","москва"]');
    expect(communityFromParams({ residence_name: "Москва" })).toBeNull();
  });

  it("creates a post and its separate target atomically only for a member", async () => {
    const { database: db, queries } = database(true);
    await createCommunityPostWithDatabase(db, interest, "author", "  Объявление  ");
    expect(queries.map((query) => query.text)).toEqual([
      "BEGIN", expect.stringContaining("FROM participant_interests"),
      expect.stringContaining("INSERT INTO community_posts"),
      expect.stringContaining("INSERT INTO community_post_targets"),
      expect.stringContaining("INSERT INTO events"), "COMMIT",
    ]);
    expect(queries.find((query) => query.text.includes("INSERT INTO community_post_targets"))?.values)
      .toEqual(["post", "interest", "история"]);
    expect(queries.find((query) => query.text.includes("INSERT INTO community_posts"))?.values)
      .toEqual(["author", "Объявление"]);
  });

  it("rejects nonmember publication and rolls the transaction back", async () => {
    const { database: db, queries } = database(false);
    await expect(createCommunityPostWithDatabase(db, residence, "author", "Текст"))
      .rejects.toBeInstanceOf(CommunityMembershipError);
    expect(queries.map((query) => query.text).at(-1)).toBe("ROLLBACK");
    expect(queries.some((query) => query.text.includes("INSERT INTO community_posts"))).toBe(false);
  });

  it("deletes only the author's post in the selected community", async () => {
    const { database: db, queries } = database(true);
    await deleteCommunityPostWithDatabase(db, interest, "author", "10000000-0000-4000-8000-000000000001");
    const update = queries.find((query) => query.text.includes("UPDATE community_posts"));
    expect(update?.text).toContain("post.author_id = $2::uuid");
    expect(update?.text).toContain("target.community_key = $4");
    expect(update?.values?.slice(1)).toEqual(["author", "interest", "история"]);
  });

  it("selects only visible profile blocks for other members", async () => {
    const queries: string[] = [];
    await listCommunitySignalsWithDatabase({ async query(text) {
      queries.push(text); return { rowCount: 0, rows: [] };
    } }, ["member"], "viewer");
    expect(queries[0]).toContain("visibility IN ('public', 'members') OR participant_id = $2::uuid");
  });
});
