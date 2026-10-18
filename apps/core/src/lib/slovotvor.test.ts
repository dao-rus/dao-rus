import { describe, expect, it } from "vitest";
import { countSlovotvorWordsByAuthor, listSlovotvorWords } from "./slovotvor";

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

    const words = await listSlovotvorWords("author-id", database);
    const count = await countSlovotvorWordsByAuthor("author-id", database);

    expect(words).toHaveLength(1);
    expect(calls[0].sql).toContain("w.author_participant_id::text = $1");
    expect(calls[0].values).toEqual(["author-id"]);
    expect(count).toBe(3);
    expect(calls[1].values).toEqual(["author-id"]);
  });
});
