import { pool } from "./db";

export type SlovotvorWord = {
  id: string;
  word: string;
  sourceWord: string;
  explanation: string | null;
  authorId: string;
  authorName: string;
  slug: string;
  createdAt: Date;
};

type Database = Pick<typeof pool, "query">;

function wordFromRow(row: Record<string, unknown>): SlovotvorWord {
  return {
    id: String(row.id),
    word: String(row.word),
    sourceWord: String(row.source_word),
    explanation: row.explanation === null ? null : String(row.explanation),
    authorId: String(row.author_id),
    authorName: String(row.author_name),
    slug: String(row.slug),
    createdAt: new Date(String(row.created_at)),
  };
}

const wordColumns = `
  SELECT w.id, w.word, w.source_word, w.explanation,
         w.author_participant_id AS author_id,
         p.display_name AS author_name,
         w.slug, w.created_at
    FROM slovotvor_words w
    JOIN participants p ON p.id = w.author_participant_id`;

export async function listSlovotvorWords(database: Database = pool): Promise<SlovotvorWord[]> {
  const result = await database.query(`${wordColumns} ORDER BY w.created_at DESC, w.id DESC`);
  return result.rows.map(wordFromRow);
}

export async function getSlovotvorWordBySlug(slug: string, database: Database = pool): Promise<SlovotvorWord | null> {
  const result = await database.query(`${wordColumns} WHERE w.slug = $1 LIMIT 1`, [slug]);
  return result.rowCount ? wordFromRow(result.rows[0]) : null;
}

export async function listSlovotvorVariants(word: SlovotvorWord, database: Database = pool): Promise<SlovotvorWord[]> {
  const result = await database.query(
    `${wordColumns}
      WHERE lower(btrim(w.source_word)) = lower(btrim($1))
        AND w.id <> $2
      ORDER BY w.created_at DESC, w.id DESC`,
    [word.sourceWord, word.id],
  );
  return result.rows.map(wordFromRow);
}
