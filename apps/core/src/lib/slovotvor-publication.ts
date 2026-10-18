import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./db";
import type { SlovotvorWord } from "./slovotvor";

const MAX_WORD_LENGTH = 120;
const MAX_EXPLANATION_LENGTH = 10000;
const slugParts = new Map([
  ["а", "a"], ["б", "b"], ["в", "v"], ["г", "g"], ["д", "d"], ["е", "e"], ["ё", "yo"],
  ["ж", "zh"], ["з", "z"], ["и", "i"], ["й", "y"], ["к", "k"], ["л", "l"], ["м", "m"],
  ["н", "n"], ["о", "o"], ["п", "p"], ["р", "r"], ["с", "s"], ["т", "t"], ["у", "u"],
  ["ф", "f"], ["х", "kh"], ["ц", "ts"], ["ч", "ch"], ["ш", "sh"], ["щ", "shch"], ["ъ", ""],
  ["ы", "y"], ["ь", ""], ["э", "e"], ["ю", "yu"], ["я", "ya"],
]);

export class SlovotvorPublicationError extends Error {
  constructor(readonly code: "required" | "too_long" | "duplicate") {
    super(`Slovotvor publication: ${code}`);
  }
}

export function transliterateSlovotvorSlug(word: string): string {
  const transliterated = [...word.toLocaleLowerCase("ru-RU")]
    .map((character) => slugParts.get(character) ?? character)
    .join("");
  const slug = transliterated
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
  return slug || "slovo";
}

export type NormalizedSlovotvorPublication = {
  word: string | null;
  sourceWord: string | null;
  explanation: string | null;
};

export function normalizePublicationInput(wordValue: unknown, sourceValue: unknown, explanationValue: unknown): NormalizedSlovotvorPublication {
  const word = typeof wordValue === "string" ? wordValue.trim() : "";
  const sourceWord = typeof sourceValue === "string" ? sourceValue.trim() : "";
  const explanation = typeof explanationValue === "string" ? explanationValue.trim() : "";
  if (!word && !sourceWord && !explanation) throw new SlovotvorPublicationError("required");
  if (word.length > MAX_WORD_LENGTH || sourceWord.length > MAX_WORD_LENGTH || explanation.length > MAX_EXPLANATION_LENGTH) {
    throw new SlovotvorPublicationError("too_long");
  }
  return { word: word || null, sourceWord: sourceWord || null, explanation: explanation || null };
}

function wordFromRow(row: Record<string, unknown>): SlovotvorWord {
  return {
    id: String(row.id),
    word: row.word === null ? null : String(row.word),
    sourceWord: row.source_word === null ? null : String(row.source_word),
    explanation: row.explanation === null ? null : String(row.explanation),
    authorId: String(row.author_id),
    authorName: String(row.author_name),
    slug: String(row.slug),
    createdAt: new Date(String(row.created_at)),
  };
}

async function findDuplicate(client: PoolClient, input: NormalizedSlovotvorPublication): Promise<SlovotvorWord | null> {
  const result = await client.query(
    `SELECT w.id,w.word,w.source_word,w.explanation,w.author_participant_id AS author_id,
            p.display_name AS author_name,w.slug,w.created_at
       FROM slovotvor_words w JOIN participants p ON p.id=w.author_participant_id
      WHERE ($1::text IS NOT NULL AND $2::text IS NOT NULL
             AND lower(btrim(w.word))=lower(btrim($1))
             AND lower(btrim(w.source_word))=lower(btrim($2)))
         OR ($1::text IS NOT NULL AND $2::text IS NULL AND w.source_word IS NULL
             AND lower(btrim(w.word))=lower(btrim($1)))
         OR ($1::text IS NULL AND $2::text IS NOT NULL AND w.word IS NULL
             AND lower(btrim(w.source_word))=lower(btrim($2)))
         OR ($1::text IS NULL AND $2::text IS NULL AND w.word IS NULL AND w.source_word IS NULL
             AND lower(btrim(w.explanation))=lower(btrim($3)))
      LIMIT 1`,
    [input.word, input.sourceWord, input.explanation],
  );
  return result.rowCount ? wordFromRow(result.rows[0]) : null;
}

export async function publishSlovotvorWord(
  participantId: string,
  wordValue: unknown,
  sourceValue: unknown,
  explanationValue: unknown,
): Promise<{ word: SlovotvorWord; duplicate: boolean }> {
  const input = normalizePublicationInput(wordValue, sourceValue, explanationValue);
  const id = randomUUID();
  const baseSlug = input.word
    ? transliterateSlovotvorSlug(input.word)
    : input.sourceWord
      ? transliterateSlovotvorSlug(input.sourceWord)
      : `slovo-${id.replaceAll("-", "")}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO slovotvor_users(participant_id) VALUES ($1) ON CONFLICT DO NOTHING", [participantId]);
    for (let suffix = 0; suffix < 10000; suffix += 1) {
      const suffixText = suffix ? `-${suffix}` : "";
      const slug = `${baseSlug.slice(0, 120 - suffixText.length)}${suffixText}`.replace(/-+$/g, "");
      const result = await client.query(
        `INSERT INTO slovotvor_words(id,word,source_word,explanation,author_participant_id,slug)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [id, input.word, input.sourceWord, input.explanation, participantId, slug],
      );
      if (result.rowCount) {
        const created = await client.query(
          `SELECT w.id,w.word,w.source_word,w.explanation,w.author_participant_id AS author_id,
                  p.display_name AS author_name,w.slug,w.created_at
             FROM slovotvor_words w JOIN participants p ON p.id=w.author_participant_id WHERE w.id=$1`,
          [id],
        );
        await client.query("COMMIT");
        return { word: wordFromRow(created.rows[0]), duplicate: false };
      }
      const existing = await findDuplicate(client, input);
      if (existing) {
        await client.query("COMMIT");
        return { word: existing, duplicate: true };
      }
    }
    throw new Error("Unable to allocate a unique Slovotvor slug");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
