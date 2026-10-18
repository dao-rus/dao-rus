import { describe, expect, it } from "vitest";
import { countSlovotvorWordsByAuthor, listSlovotvorVariants, listSlovotvorWords } from "./slovotvor";

describe("Slovotvor word list", () => {
  it("filters by author on the server and counts that author's words", async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const database = {
      query: async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        if (sql.startsWith("SELECT count")) return { rows: [{ count: 3 }], rowCount: 1 };
        return {
          rows: [{
            id: "word-id", word: "слово", source_word: "word", explanation: null,
            author_id: "author-id", author_name: "Автор", slug: "slovo", created_at: "2026-01-01T00:00:00Z",
          }],
          rowCount: 1,
        };
      },
    } as any;

    const words = await listSlovotvorWords("author-id", "old", database);
    const count = await countSlovotvorWordsByAuthor("author-id", database);

    expect(words).toHaveLength(1);
    expect(calls[0].sql).toContain("w.author_participant_id::text = $1");
    expect(calls[0].sql).toContain("w.created_at ASC, w.id ASC");
    expect(calls[0].values).toEqual(["author-id"]);
    expect(count).toBe(3);
    expect(calls[1].values).toEqual(["author-id"]);
  });

  it("builds server-side ordering for the four sort modes", async () => {
    const queries: string[] = [];
    const database = { query: async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 0 }; } } as any;

    await listSlovotvorWords(undefined, "top", database);
    await listSlovotvorWords(undefined, "alpha", database);
    await listSlovotvorWords(undefined, "new", database);
    await listSlovotvorWords(undefined, "old", database);

    expect(queries[0]).toContain("ORDER BY CASE WHEN w.word IS NULL THEN 1 ELSE 0 END, better_votes DESC, w.created_at DESC, w.id DESC");
    expect(queries[1]).toContain("translate(lower(btrim(COALESCE(w.word, w.source_word, w.explanation)))");
    expect(queries[1]).toContain("w.created_at DESC, w.id DESC");
    expect(queries[2]).toContain("ORDER BY w.created_at DESC, w.id DESC");
    expect(queries[3]).toContain("ORDER BY w.created_at ASC, w.id ASC");
  });

  it("loads variants by stable parent publication ID", async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const database = {
      query: async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return { rows: [], rowCount: 0 };
      },
    } as any;
    const parent = {
      id: "parent-id", word: null, sourceWord: "промпт", explanation: null,
      authorId: "author-id", authorName: "Автор", parentId: null, slug: "prompt",
      createdAt: new Date(), betterVotes: 0, worseVotes: 0,
    };

    await listSlovotvorVariants(parent, database);

    expect(calls[0].sql).toContain("WHERE w.parent_id = $1");
    expect(calls[0].sql).toContain("ORDER BY better_votes DESC, w.created_at DESC, w.id DESC");
    expect(calls[0].values).toEqual(["parent-id"]);
  });
});
