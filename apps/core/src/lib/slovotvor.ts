import { pool } from "./db";

export type SlovotvorWord = {
  id: string;
  word: string | null;
  sourceWord: string | null;
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
    word: row.word === null ? null : String(row.word),
    sourceWord: row.source_word === null ? null : String(row.source_word),
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

export function listSlovotvorWords(database?: Database): Promise<SlovotvorWord[]>;
export function listSlovotvorWords(authorId: string | undefined, database?: Database): Promise<SlovotvorWord[]>;
export async function listSlovotvorWords(authorOrDatabase?: string | Database, database: Database = pool): Promise<SlovotvorWord[]> {
  const authorId = typeof authorOrDatabase === "string" ? authorOrDatabase : undefined;
  const queryDatabase = typeof authorOrDatabase === "string" || authorOrDatabase === undefined ? database : authorOrDatabase;
  const filter = authorId ? " WHERE w.author_participant_id::text = $1" : "";
  const result = await queryDatabase.query(`${wordColumns}${filter} ORDER BY w.created_at DESC, w.id DESC`, authorId ? [authorId] : []);
  return result.rows.map(wordFromRow);
}

export async function countSlovotvorWordsByAuthor(authorId: string, database: Database = pool): Promise<number> {
  const result = await database.query("SELECT count(*)::int AS count FROM slovotvor_words WHERE author_participant_id = $1", [authorId]);
  return Number(result.rows[0]?.count ?? 0);
}

export async function getSlovotvorAuthorById(authorId: string, database: Database = pool): Promise<{ id: string; displayName: string; telegramUsername: string | null } | null> {
  const result = await database.query(
    `SELECT p.id, p.display_name, e.username AS telegram_username
       FROM participants p
       LEFT JOIN external_identities e ON e.participant_id = p.id AND e.provider = 'telegram'
      WHERE p.id::text = $1
      LIMIT 1`,
    [authorId],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    telegramUsername: row.telegram_username ? String(row.telegram_username) : null,
  };
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
