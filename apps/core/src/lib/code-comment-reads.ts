import { pool } from "./db";
import type { CodeCommentsDatabase, CodeSection } from "./code-comments";

type Database = Pick<CodeCommentsDatabase, "query">;

export async function unreadCodeCommentsWithDatabase(database: Database, participantId: string) {
  const result = await database.query(`SELECT c.id, c.section_key, count(*) OVER()::integer AS total
    FROM code_comments c
    WHERE c.deleted_at IS NULL AND c.hidden_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM code_comment_reads r WHERE r.participant_id = $1::uuid AND r.comment_id = c.id)
    ORDER BY c.created_at, c.id LIMIT 1`, [participantId]);
  const row = result.rows[0];
  return row ? { count: Number(row.total), section: String(row.section_key) as CodeSection, id: String(row.id) } : null;
}

export async function markCodeCommentsReadWithDatabase(database: Database, participantId: string, ids: string[]) {
  if (!ids.length) return;
  await database.query(`INSERT INTO code_comment_reads (participant_id, comment_id)
    SELECT $1::uuid, c.id FROM code_comments c
    WHERE c.id = ANY($2::uuid[]) AND c.hidden_at IS NULL AND c.deleted_at IS NULL
    ON CONFLICT DO NOTHING`, [participantId, ids]);
}

export const unreadCodeComments = (participantId: string) => unreadCodeCommentsWithDatabase(pool, participantId);
export const markCodeCommentsRead = (participantId: string, ids: string[]) => markCodeCommentsReadWithDatabase(pool, participantId, ids);
