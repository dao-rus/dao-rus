import type { PoolClient } from "pg";
import { pool } from "./db";

const MAX_SOURCE_WORD_LENGTH = 120;

export type SlovotvorReplacementRequest = {
  id: string;
  sourceWord: string;
  authorId: string;
  authorName: string;
  createdAt: Date;
};

export class SlovotvorReplacementError extends Error {
  constructor(public readonly code: "required" | "too_long" | "duplicate") {
    super(code);
  }
}

type Database = Pick<typeof pool, "query">;

function replacementFromRow(row: Record<string, unknown>): SlovotvorReplacementRequest {
  return {
    id: String(row.id),
    sourceWord: String(row.source_word),
    authorId: String(row.author_id),
    authorName: String(row.author_name),
    createdAt: new Date(String(row.created_at)),
  };
}

const replacementColumns = `
  SELECT r.id, r.source_word,
         r.author_participant_id AS author_id,
         p.display_name AS author_name,
         r.created_at
    FROM slovotvor_replacement_requests r
    JOIN participants p ON p.id = r.author_participant_id`;

export function normalizeReplacementSource(value: unknown): string {
  const sourceWord = typeof value === "string" ? value.trim() : "";
  if (!sourceWord) throw new SlovotvorReplacementError("required");
  if (sourceWord.length > MAX_SOURCE_WORD_LENGTH) throw new SlovotvorReplacementError("too_long");
  return sourceWord;
}

export async function listSlovotvorReplacementRequests(database: Database = pool): Promise<SlovotvorReplacementRequest[]> {
  const result = await database.query(`${replacementColumns} ORDER BY r.created_at DESC, r.id DESC`);
  return result.rows.map(replacementFromRow);
}

export async function getSlovotvorReplacementRequestById(id: string, database: Database = pool): Promise<SlovotvorReplacementRequest | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
  const result = await database.query(`${replacementColumns} WHERE r.id = $1 LIMIT 1`, [id]);
  return result.rowCount ? replacementFromRow(result.rows[0]) : null;
}

async function findBySourceWord(client: PoolClient, sourceWord: string): Promise<SlovotvorReplacementRequest | null> {
  const result = await client.query(`${replacementColumns} WHERE lower(btrim(r.source_word)) = lower(btrim($1)) LIMIT 1`, [sourceWord]);
  return result.rowCount ? replacementFromRow(result.rows[0]) : null;
}

export async function publishSlovotvorReplacementRequest(participantId: string, sourceWordValue: unknown) {
  const sourceWord = normalizeReplacementSource(sourceWordValue);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO slovotvor_users(participant_id) VALUES ($1) ON CONFLICT DO NOTHING", [participantId]);
    const inserted = await client.query(
      `INSERT INTO slovotvor_replacement_requests(source_word, author_participant_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [sourceWord, participantId],
    );
    if (inserted.rowCount) {
      const request = await getSlovotvorReplacementRequestById(String(inserted.rows[0].id), client);
      if (!request) throw new Error("Created Slovotvor replacement request was not found");
      await client.query("COMMIT");
      return { request, duplicate: false };
    }
    const duplicate = await findBySourceWord(client, sourceWord);
    if (!duplicate) throw new Error("Unable to create Slovotvor replacement request");
    await client.query("COMMIT");
    return { request: duplicate, duplicate: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
