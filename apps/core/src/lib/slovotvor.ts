import { pool } from "./db";

export type SlovotvorWord = {
  id: string;
  word: string | null;
  sourceWord: string | null;
  explanation: string | null;
  authorId: string;
  authorName: string;
  parentId: string | null;
  slug: string;
  createdAt: Date;
  betterVotes: number;
  worseVotes: number;
};

type Database = Pick<typeof pool, "query">;
type VoteDatabase = Pick<typeof pool, "query" | "connect">;

export type SlovotvorSort = "top" | "alpha" | "new" | "old";
export type SlovotvorVoteChoice = "better" | "worse";

export class SlovotvorVoteError extends Error {
  constructor(readonly code: "invalid" | "missing") {
    super(`Slovotvor vote ${code}`);
  }
}

const russianAlphabet = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
const russianAlphabetOrder = "0123456789abcdefghijklmnopqrstuvw";

function wordFromRow(row: Record<string, unknown>): SlovotvorWord {
  return {
    id: String(row.id),
    word: row.word === null ? null : String(row.word),
    sourceWord: row.source_word === null ? null : String(row.source_word),
    explanation: row.explanation === null ? null : String(row.explanation),
    authorId: String(row.author_id),
    authorName: String(row.author_name),
    parentId: row.parent_id == null ? null : String(row.parent_id),
    slug: String(row.slug),
    createdAt: new Date(String(row.created_at)),
    betterVotes: Number(row.better_votes ?? 0),
    worseVotes: Number(row.worse_votes ?? 0),
  };
}

const wordColumns = `
  SELECT w.id, w.word, w.source_word, w.explanation, w.parent_id,
         w.author_participant_id AS author_id,
         p.display_name AS author_name,
         w.slug, w.created_at,
         (SELECT count(*)::int FROM slovotvor_votes v WHERE v.word_id = w.id AND v.choice = 'better') AS better_votes,
         (SELECT count(*)::int FROM slovotvor_votes v WHERE v.word_id = w.id AND v.choice = 'worse') AS worse_votes
    FROM slovotvor_words w
    JOIN participants p ON p.id = w.author_participant_id`;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function listSlovotvorWords(database?: Database): Promise<SlovotvorWord[]>;
export function listSlovotvorWords(authorId: string | undefined, database?: Database): Promise<SlovotvorWord[]>;
export function listSlovotvorWords(authorId: string | undefined, sort: SlovotvorSort, database?: Database): Promise<SlovotvorWord[]>;
export async function listSlovotvorWords(
  authorOrDatabase?: string | Database,
  sortOrDatabase: SlovotvorSort | Database = "top",
  database: Database = pool,
): Promise<SlovotvorWord[]> {
  const authorId = typeof authorOrDatabase === "string" ? authorOrDatabase : undefined;
  const sort = typeof sortOrDatabase === "string" ? sortOrDatabase : "top";
  const queryDatabase = typeof sortOrDatabase === "string"
    ? (typeof authorOrDatabase === "string" || authorOrDatabase === undefined ? database : authorOrDatabase)
    : sortOrDatabase;
  const filter = authorId ? " WHERE w.author_participant_id::text = $1" : "";
  const orderBy = sort === "old"
    ? "w.created_at ASC, w.id ASC"
    : sort === "alpha"
      ? `translate(lower(btrim(COALESCE(w.word, w.source_word, w.explanation))), '${russianAlphabet}', '${russianAlphabetOrder}'), w.created_at DESC, w.id DESC`
      : sort === "top"
        ? "CASE WHEN w.word IS NULL THEN 1 ELSE 0 END, better_votes DESC, w.created_at DESC, w.id DESC"
        : "w.created_at DESC, w.id DESC";
  const result = await queryDatabase.query(`${wordColumns}${filter} ORDER BY ${orderBy}`, authorId ? [authorId] : []);
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

export async function getSlovotvorWordById(id: string, database: Database = pool): Promise<SlovotvorWord | null> {
  if (!uuidPattern.test(id)) return null;
  const result = await database.query(`${wordColumns} WHERE w.id = $1 LIMIT 1`, [id]);
  return result.rowCount ? wordFromRow(result.rows[0]) : null;
}

export async function getSlovotvorVoteSummary(
  wordId: string,
  participantId?: string,
  database: Database = pool,
): Promise<{ better: number; worse: number; ownVote: SlovotvorVoteChoice | null }> {
  const result = await database.query(
    `SELECT count(*) FILTER (WHERE choice = 'better')::int AS better,
            count(*) FILTER (WHERE choice = 'worse')::int AS worse,
            (SELECT choice FROM slovotvor_votes WHERE word_id = $1 AND participant_id = $2) AS own_vote
       FROM slovotvor_votes
      WHERE word_id = $1`,
    [wordId, participantId ?? null],
  );
  const row = result.rows[0] ?? {};
  return {
    better: Number(row.better ?? 0),
    worse: Number(row.worse ?? 0),
    ownVote: row.own_vote === "better" || row.own_vote === "worse" ? row.own_vote : null,
  };
}

export async function castSlovotvorVoteWithDatabase(
  database: VoteDatabase,
  wordId: string,
  participantId: string,
  choice: unknown,
): Promise<void> {
  const vote = String(choice);
  if (!uuidPattern.test(wordId) || !["better", "worse"].includes(vote)) throw new SlovotvorVoteError("invalid");

  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const publication = await client.query(
      "SELECT id FROM slovotvor_words WHERE id = $1 AND word IS NOT NULL FOR SHARE",
      [wordId],
    );
    if (!publication.rowCount) throw new SlovotvorVoteError("missing");
    await client.query("INSERT INTO slovotvor_users(participant_id) VALUES ($1) ON CONFLICT DO NOTHING", [participantId]);

    const existing = await client.query(
      "SELECT choice FROM slovotvor_votes WHERE word_id = $1 AND participant_id = $2 FOR UPDATE",
      [wordId, participantId],
    );
    if (existing.rows[0]?.choice === vote) {
      await client.query("DELETE FROM slovotvor_votes WHERE word_id = $1 AND participant_id = $2", [wordId, participantId]);
    } else {
      await client.query(
        `INSERT INTO slovotvor_votes(word_id, participant_id, choice)
         VALUES ($1, $2, $3)
         ON CONFLICT (word_id, participant_id)
         DO UPDATE SET choice = EXCLUDED.choice, created_at = now()`,
        [wordId, participantId, vote],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function castSlovotvorVote(wordId: string, participantId: string, choice: unknown): Promise<void> {
  const { pool: database } = await import("./db");
  return castSlovotvorVoteWithDatabase(database, wordId, participantId, choice);
}

export async function listSlovotvorVariants(word: SlovotvorWord, database: Database = pool): Promise<SlovotvorWord[]> {
  const result = await database.query(
    `${wordColumns}
      WHERE w.parent_id = $1
      ORDER BY better_votes DESC, w.created_at DESC, w.id DESC`,
    [word.id],
  );
  return result.rows.map(wordFromRow);
}
