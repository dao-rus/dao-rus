import { pool } from "./db";
import { VERIFIED_SUBJECTS_CTE } from "./verification";

export const CODE_SECTIONS = ["dao-code-1", "dao-code-2", "dao-code-3", "dao-code-all"] as const;
export type CodeSection = (typeof CODE_SECTIONS)[number];
export type CodeSort = "latest" | "top";
export type CodeComment = {
  id: string;
  section: CodeSection;
  parentId: string | null;
  authorId: string;
  authorName: string;
  verificationPoints: number;
  positiveCount: number;
  body: string | null;
  deleted: boolean;
  hidden: boolean;
  hiddenReason: string | null;
  pinned: boolean;
  helpfulCount: number;
  helpedByViewer: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
type Client = { query(sql: string, values?: unknown[]): Promise<QueryResult>; release(): void };
export type CodeCommentsDatabase = { query(sql: string, values?: unknown[]): Promise<QueryResult>; connect(): Promise<Client> };

export class CodeCommentValidationError extends Error {}
export class CodeCommentAccessError extends Error {}
export class CodeCommentRateLimitError extends Error {}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCodeSection(value: unknown): CodeSection {
  if (typeof value !== "string" || !CODE_SECTIONS.includes(value as CodeSection)) {
    throw new CodeCommentValidationError("Invalid section");
  }
  return value as CodeSection;
}

function parseId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new CodeCommentValidationError("Invalid comment ID");
  }
  return value;
}

function parseBody(value: unknown, limit: number): string {
  if (typeof value !== "string") throw new CodeCommentValidationError("Invalid text");
  const body = value.trim();
  if (!body || body.length > limit) throw new CodeCommentValidationError("Invalid text length");
  return body;
}

export function parseCodeSort(value: unknown): CodeSort {
  return value === "top" ? "top" : "latest";
}

export async function listCodeCommentsWithDatabase(
  database: Pick<CodeCommentsDatabase, "query">,
  viewerId: string | null,
): Promise<CodeComment[]> {
  const result = await database.query(
    `${VERIFIED_SUBJECTS_CTE}
     SELECT c.id, c.section_key, c.parent_id, c.author_id, p.display_name,
            CASE WHEN c.deleted_at IS NULL AND c.hidden_at IS NULL THEN c.body ELSE NULL END AS body,
            c.deleted_at IS NOT NULL AS deleted, c.hidden_at IS NOT NULL AS hidden,
            CASE WHEN c.hidden_at IS NOT NULL THEN c.hidden_reason ELSE NULL END AS hidden_reason,
            c.pinned_at IS NOT NULL AS pinned, c.created_at, c.updated_at,
            (SELECT count(*)::integer FROM verification_attestations a
              JOIN verified v ON v.subject_id = a.verifier_subject_id
              WHERE a.subject_id = c.author_id AND a.revoked_at IS NULL) AS verification_points,
            (SELECT count(*)::integer FROM reputation_signals r
              WHERE r.subject_participant_id = c.author_id AND r.dimension = 'interaction_quality'
                AND r.signal_type = 'positive' AND r.revoked_at IS NULL) AS positive_count,
            (SELECT count(*)::integer FROM code_comment_helpful h WHERE h.comment_id = c.id) AS helpful_count,
            EXISTS (SELECT 1 FROM code_comment_helpful h
              WHERE h.comment_id = c.id AND h.participant_id = $1::uuid) AS helped_by_viewer
       FROM code_comments c
       JOIN participants p ON p.id = c.author_id
      ORDER BY c.created_at, c.id`,
    [viewerId],
  );
  return result.rows.map((row) => ({
    id: String(row.id), section: parseCodeSection(row.section_key),
    parentId: row.parent_id ? String(row.parent_id) : null,
    authorId: String(row.author_id), authorName: String(row.display_name),
    verificationPoints: Number(row.verification_points), positiveCount: Number(row.positive_count),
    body: row.deleted || row.hidden || row.body === null ? null : String(row.body),
    deleted: Boolean(row.deleted), hidden: Boolean(row.hidden),
    hiddenReason: row.hidden_reason ? String(row.hidden_reason) : null,
    pinned: Boolean(row.pinned), helpfulCount: Number(row.helpful_count),
    helpedByViewer: Boolean(row.helped_by_viewer),
    createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)),
  }));
}

export async function listCodeComments(viewerId: string | null): Promise<CodeComment[]> {
  return listCodeCommentsWithDatabase(pool, viewerId);
}

export function sortCodeCommentRoots(comments: CodeComment[], sort: CodeSort): CodeComment[] {
  return comments.filter((comment) => !comment.parentId).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === "top" && a.helpfulCount !== b.helpfulCount) return b.helpfulCount - a.helpfulCount;
    return b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id);
  });
}

export function sortCodeCommentReplies(comments: CodeComment[]): CodeComment[] {
  return comments.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}
export type CodeCommentAction = "create" | "edit" | "delete" | "helpful" | "pin" | "unpin" | "hide" | "unhide";
export function parseCodeCommentAction(value: unknown): CodeCommentAction {
  if (typeof value !== "string" || !["create", "edit", "delete", "helpful", "pin", "unpin", "hide", "unhide"].includes(value)) {
    throw new CodeCommentValidationError("Invalid action");
  }
  return value as CodeCommentAction;
}

export async function changeCodeCommentWithDatabase(
  database: CodeCommentsDatabase,
  actorId: string,
  isAdmin: boolean,
  input: { action: CodeCommentAction; section: unknown; commentId?: unknown; parentId?: unknown; body?: unknown; reason?: unknown },
): Promise<void> {
  const section = parseCodeSection(input.section);
  const action = parseCodeCommentAction(input.action);
  const body = action === "create" || action === "edit" ? parseBody(input.body, 2000) : null;
  const reason = action === "hide" ? parseBody(input.reason, 500) : null;
  const commentId = action === "create" ? null : parseId(input.commentId);
  const parentId = input.parentId === null || input.parentId === "" || input.parentId === undefined
    ? null : parseId(input.parentId);
  if (action !== "create" && parentId) throw new CodeCommentValidationError("Unexpected parent");

  const client = await database.connect();
  try {
    await client.query("BEGIN");
    let affectedId: string;
    if (action === "create") {
      // The participant row serializes concurrent submissions and enforces the publication interval.
      const actor = await client.query("SELECT id FROM participants WHERE id = $1::uuid FOR UPDATE", [actorId]);
      if (!actor.rowCount) throw new CodeCommentAccessError("Participant not found");
      const recent = await client.query(
        "SELECT 1 FROM code_comments WHERE author_id = $1::uuid AND created_at > now() - interval '30 seconds' LIMIT 1",
        [actorId],
      );
      if (recent.rowCount) throw new CodeCommentRateLimitError("Please wait before posting again");
      if (parentId) {
        const parent = await client.query(
          "SELECT section_key, parent_id, deleted_at, hidden_at FROM code_comments WHERE id = $1::uuid FOR SHARE",
          [parentId],
        );
        const row = parent.rows[0];
        if (!row || row.section_key !== section || row.parent_id || row.deleted_at || row.hidden_at) {
          throw new CodeCommentValidationError("Invalid reply target");
        }
      }
      const inserted = await client.query(
        `INSERT INTO code_comments(section_key, author_id, parent_id, body)
         VALUES ($1, $2::uuid, $3::uuid, $4) RETURNING id`,
        [section, actorId, parentId, body],
      );
      affectedId = String(inserted.rows[0].id);
    } else {
      const found = await client.query(
        `SELECT id, section_key, parent_id, author_id, deleted_at, hidden_at, pinned_at
           FROM code_comments WHERE id = $1::uuid FOR UPDATE`,
        [commentId],
      );
      const row = found.rows[0];
      if (!row || row.section_key !== section) throw new CodeCommentValidationError("Comment not found in section");
      affectedId = String(row.id);
      if (action === "edit" || action === "delete") {
        if (row.author_id !== actorId || row.deleted_at || row.hidden_at) {
          throw new CodeCommentAccessError("Comment cannot be changed");
        }
        if (action === "edit") {
          await client.query("UPDATE code_comments SET body = $2, updated_at = now() WHERE id = $1::uuid", [commentId, body]);
        } else {
          await client.query("UPDATE code_comments SET body = NULL, deleted_at = now(), updated_at = now(), pinned_at = NULL, pinned_by = NULL WHERE id = $1::uuid", [commentId]);
        }
      } else if (action === "helpful") {
        if (row.author_id === actorId || row.deleted_at || row.hidden_at) {
          throw new CodeCommentAccessError("Helpful mark unavailable");
        }
        const existing = await client.query(
          "SELECT 1 FROM code_comment_helpful WHERE comment_id = $1::uuid AND participant_id = $2::uuid",
          [commentId, actorId],
        );
        if (existing.rowCount) {
          await client.query("DELETE FROM code_comment_helpful WHERE comment_id = $1::uuid AND participant_id = $2::uuid", [commentId, actorId]);
        } else {
          await client.query("INSERT INTO code_comment_helpful(comment_id, participant_id) VALUES ($1::uuid, $2::uuid)", [commentId, actorId]);
        }
      } else {
        if (!isAdmin) throw new CodeCommentAccessError("Admin access required");
        if (action === "pin") {
          if (row.parent_id || row.deleted_at || row.hidden_at) throw new CodeCommentValidationError("Cannot pin comment");
          await client.query("UPDATE code_comments SET pinned_at = now(), pinned_by = $2::uuid WHERE id = $1::uuid", [commentId, actorId]);
        } else if (action === "unpin") {
          await client.query("UPDATE code_comments SET pinned_at = NULL, pinned_by = NULL WHERE id = $1::uuid", [commentId]);
        } else if (action === "hide") {
          if (row.deleted_at) throw new CodeCommentValidationError("Cannot hide deleted comment");
          await client.query(
            "UPDATE code_comments SET hidden_at = now(), hidden_by = $2::uuid, hidden_reason = $3, pinned_at = NULL, pinned_by = NULL WHERE id = $1::uuid",
            [commentId, actorId, reason],
          );
        } else {
          await client.query("UPDATE code_comments SET hidden_at = NULL, hidden_by = NULL, hidden_reason = NULL WHERE id = $1::uuid", [commentId]);
        }
      }
    }
    await client.query(
      "INSERT INTO events(event_type, participant_id, payload) VALUES ($1, $2::uuid, $3::jsonb)",
      [`code.comment_${action}`, actorId, JSON.stringify({ comment_id: affectedId, section_key: section })],
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original error. */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function changeCodeComment(
  actorId: string, isAdmin: boolean,
  input: Parameters<typeof changeCodeCommentWithDatabase>[3],
): Promise<void> {
  return changeCodeCommentWithDatabase(pool, actorId, isAdmin, input);
}
