import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("./db", () => ({ pool: { connect: mocks.connect } }));

import { normalizePublicationInput, publishSlovotvorWord, SlovotvorPublicationError, transliterateSlovotvorSlug } from "./slovotvor-publication";

describe("Slovotvor slugs", () => {
  it("transliterates Russian words and keeps е distinct from ё", () => {
    expect(transliterateSlovotvorSlug("крайнесрок")).toBe("kraynesrok");
    expect(transliterateSlovotvorSlug("ёлка")).toBe("yolka");
    expect(transliterateSlovotvorSlug("елка")).toBe("elka");
  });
});

describe("Slovotvor publication input", () => {
  it.each([
    ["pair", "слово", "замена", "описание"],
    ["word only", "слово", "", ""],
    ["source only", "", "замена", ""],
    ["description only", "", "", "описание"],
  ])("accepts the %s publication form", (_kind, word, source, explanation) => {
    expect(normalizePublicationInput(` ${word} `, ` ${source} `, ` ${explanation} `)).toEqual({
      word: word || null, sourceWord: source || null, explanation: explanation || null,
    });
  });

  it("rejects a publication with only whitespace", () => {
    expect(() => normalizePublicationInput("  ", "\t", " ")).toThrowError(new SlovotvorPublicationError("required"));
  });
});

describe("Slovotvor task variants", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores the stable parent ID and the parent's source word", async () => {
    const parentId = "42a8c373-486f-4ebc-bc06-24dcd2a2f8c6";
    const client = {
      queries: [] as Array<{ sql: string; values?: unknown[] }>,
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        client.queries.push({ sql, values });
        if (sql.startsWith("SELECT id, word, source_word")) return { rows: [{ id: parentId, word: null, source_word: "промпт", explanation: null }], rowCount: 1 };
        if (sql.startsWith("INSERT INTO slovotvor_words")) return { rows: [{ id: "variant-id" }], rowCount: 1 };
        if (sql.startsWith("SELECT w.id,w.word")) return { rows: [{ id: "variant-id", word: "промысло", source_word: "промпт", explanation: null, parent_id: parentId, author_id: "author-id", author_name: "Автор", slug: "promyslo", created_at: "2026-01-01T00:00:00Z" }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(client);

    const result = await publishSlovotvorWord("author-id", "промысло", "чужое", "", parentId);
    const insert = client.queries.find((query) => query.sql.startsWith("INSERT INTO slovotvor_words"));

    expect(insert?.sql).toContain("parent_id");
    expect(insert?.values?.at(-1)).toBe(parentId);
    expect(insert?.values?.[2]).toBe("промпт");
    expect(result.word.parentId).toBe(parentId);
  });

  it("rejects a task link without a proposed new word", async () => {
    const parentId = "42a8c373-486f-4ebc-bc06-24dcd2a2f8c6";
    const client = { query: vi.fn(), release: vi.fn() };
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: parentId, word: null, source_word: "промпт", explanation: null }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    mocks.connect.mockResolvedValue(client);

    await expect(publishSlovotvorWord("author-id", "", "промпт", "", parentId))
      .rejects.toThrowError(new SlovotvorPublicationError("parent_invalid"));
  });
});
