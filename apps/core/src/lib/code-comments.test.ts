import { describe, expect, it } from "vitest";
import { DAO_CODE_CLAUSES } from "./dao-code";
import {
  CODE_SECTIONS,
  changeCodeCommentWithDatabase,
  CodeCommentAccessError,
  CodeCommentRateLimitError,
  CodeCommentValidationError,
  listCodeCommentsWithDatabase,
  sortCodeCommentReplies,
  sortCodeCommentRoots,
  type CodeComment,
  type CodeCommentsDatabase,
} from "./code-comments";

const actor = "10000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";
const commentId = "30000000-0000-4000-8000-000000000003";
const parentId = "40000000-0000-4000-8000-000000000004";

function databaseWith(handler: (sql: string, values?: unknown[]) => { rows?: Array<Record<string, unknown>>; rowCount?: number }) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      const response = handler(sql, values);
      return { rows: response.rows ?? [], rowCount: response.rowCount ?? response.rows?.length ?? 0 };
    },
    release() {},
  };
  const database: CodeCommentsDatabase = { query: client.query, async connect() { return client; } };
  return { database, calls };
}

function comment(id: string, createdAt: string, helpfulCount: number, pinned = false, parent: string | null = null): CodeComment {
  return { id, section: "dao-code-1", parentId: parent, authorId: actor, authorName: "Автор",
    verificationPoints: 2, positiveCount: 3, body: "Текст", deleted: false, hidden: false,
    hiddenReason: null, pinned, helpfulCount, helpedByViewer: false,
    createdAt: new Date(createdAt), updatedAt: new Date(createdAt) };
}

describe("code comments", () => {
  it.each([false, true])("notifies only the root author atomically with editable text, falling back for empty overrides (%s)", async (empty) => {
    const { database, calls } = databaseWith((sql) => {
      if (sql.includes("FROM participants")) return { rows: [{ id: actor }] };
      if (sql.includes("FROM code_comments WHERE id")) return { rows: [{ section_key: "dao-code-1", parent_id: null, author_id: other }] };
      if (sql.includes("INSERT INTO code_comments") || sql.includes("INSERT INTO notifications")) return { rows: [{ id: commentId }] };
      if (sql.includes("FROM ui_text_overrides")) return { rows: [
        { key: "notifications.code_reply", value: empty ? "  " : "Получен ответ на ваш комментарий." },
        { key: "notifications.code_reply_action", value: empty ? "" : "Посмотреть ответ" },
      ] };
      return { rows: [] };
    });
    await changeCodeCommentWithDatabase(database, actor, false, {
      action: "create", section: "dao-code-1", parentId, body: "Текст ответа не копируется в уведомление",
    });
    const notice = calls.find(c => c.sql.includes("INSERT INTO notifications"))!;
    expect(notice.values).toEqual([other, "code.comment_reply", empty ? "На ваш комментарий к Кодексу ответили." : "Получен ответ на ваш комментарий.",
      `/code?section=dao-code-1#comment-${commentId}`, empty ? "Открыть ответ" : "Посмотреть ответ", "system", null, true, commentId]);
    expect(calls.find(c => c.sql.includes("INSERT INTO notification_deliveries"))?.values).toEqual([commentId]);
    expect(calls.filter(c => /^(BEGIN|COMMIT|ROLLBACK)$/.test(c.sql)).map(c => c.sql)).toEqual(["BEGIN", "COMMIT"]);
    expect(calls.findIndex(c => c.sql.includes("INSERT INTO events"))).toBeLessThan(calls.indexOf(notice));
  });

  it.each([null, parentId])("does not notify for a root or a self reply (%s)", async (parent) => {
    const { database, calls } = databaseWith((sql) => {
      if (sql.includes("FROM participants")) return { rows: [{ id: actor }] };
      if (sql.includes("FROM code_comments WHERE id")) return { rows: [{ section_key: "dao-code-1", parent_id: null, author_id: actor }] };
      if (sql.includes("INSERT INTO code_comments")) return { rows: [{ id: commentId }] };
      return { rows: [] };
    });
    await changeCodeCommentWithDatabase(database, actor, false, { action: "create", section: "dao-code-1", parentId: parent, body: "Текст" });
    expect(calls.some(c => c.sql.includes("INSERT INTO notifications") || c.sql.includes("INSERT INTO notification_deliveries"))).toBe(false);
  });

  it("uses the stable canonical clause IDs plus the whole-code key", () => {
    expect(CODE_SECTIONS).toEqual([...DAO_CODE_CLAUSES.map((clause) => clause.id), "dao-code-all"]);
  });
  it("orders pinned roots first, latest by creation and top by helpful marks; replies oldest first", () => {
    const older = comment(actor, "2026-01-01T00:00:00Z", 5);
    const newer = comment(other, "2026-01-02T00:00:00Z", 5);
    const pinned = comment(commentId, "2025-01-01T00:00:00Z", 0, true);
    const low = comment(parentId, "2026-01-03T00:00:00Z", 1);
    const reply = comment("50000000-0000-4000-8000-000000000005", "2026-01-04T00:00:00Z", 0, false, older.id);
    expect(sortCodeCommentRoots([older, newer, pinned, low, reply], "latest").map((item) => item.id))
      .toEqual([pinned.id, low.id, newer.id, older.id]);
    expect(sortCodeCommentRoots([older, newer, pinned, low, reply], "top").map((item) => item.id))
      .toEqual([pinned.id, newer.id, older.id, low.id]);
    expect(sortCodeCommentReplies([reply, older]).map((item) => item.id)).toEqual([older.id, reply.id]);
  });

  it("never returns hidden or deleted body and reads current indices and helpful state", async () => {
    const { database, calls } = databaseWith(() => ({ rows: [
      { id: commentId, section_key: "dao-code-1", parent_id: null, author_id: actor,
        display_name: "Автор", body: "Текст", deleted: false, hidden: false, hidden_reason: null,
        pinned: false, verification_points: 2, positive_count: 3, helpful_count: 4,
        helped_by_viewer: true, created_at: new Date("2026-01-01"), updated_at: new Date("2026-01-01") },
      { id: parentId, section_key: "dao-code-all", parent_id: null, author_id: other,
        display_name: "Другой", body: "Секрет", deleted: false, hidden: true, hidden_reason: "Причина",
        pinned: false, verification_points: 0, positive_count: 0, helpful_count: 0,
        helped_by_viewer: false, created_at: new Date("2026-01-01"), updated_at: new Date("2026-01-01") },
      { id: other, section_key: "dao-code-2", parent_id: null, author_id: other,
        display_name: "Другой", body: "Удалённый секрет", deleted: true, hidden: false, hidden_reason: null,
        pinned: false, verification_points: 0, positive_count: 0, helpful_count: 0,
        helped_by_viewer: false, created_at: new Date("2026-01-01"), updated_at: new Date("2026-01-01") },
    ] }));
    const comments = await listCodeCommentsWithDatabase(database, actor);
    expect(comments.map((item) => item.body)).toEqual(["Текст", null, null]);
    expect(comments[0]).toMatchObject({ verificationPoints: 2, positiveCount: 3, helpfulCount: 4, helpedByViewer: true });
    expect(calls[0].sql).toContain("CASE WHEN c.deleted_at IS NULL AND c.hidden_at IS NULL THEN c.body ELSE NULL END");
    expect(calls[0].sql).toContain("JOIN verified v");
    expect(calls[0].sql).toContain("r.signal_type = 'positive'");
  });

  it("rejects a reply to a reply and enforces publication interval before insertion", async () => {
    const { database, calls } = databaseWith((sql) => {
      if (sql.includes("FROM participants")) return { rows: [{ id: actor }] };
      if (sql.includes("created_at >")) return { rows: [] };
      if (sql.includes("FROM code_comments WHERE id")) return { rows: [{ section_key: "dao-code-1", parent_id: other }] };
      return { rows: [] };
    });
    await expect(changeCodeCommentWithDatabase(database, actor, false, {
      action: "create", section: "dao-code-1", parentId, body: "Ответ",
    })).rejects.toBeInstanceOf(CodeCommentValidationError);
    expect(calls.some((call) => call.sql.includes("INSERT INTO code_comments"))).toBe(false);
    expect(calls.at(-1)?.sql).toBe("ROLLBACK");

    const rate = databaseWith((sql) => sql.includes("FROM participants") || sql.includes("created_at >")
      ? { rows: [{ id: actor }] } : { rows: [] });
    await expect(changeCodeCommentWithDatabase(rate.database, actor, false, {
      action: "create", section: "dao-code-all", body: "Второй комментарий",
    })).rejects.toBeInstanceOf(CodeCommentRateLimitError);
    expect(rate.calls.some((call) => call.sql.includes("INSERT INTO code_comments"))).toBe(false);
  });

  it("permits owner deletion with a retained row, prevents self support, and requires admin for hiding", async () => {
    const owner = databaseWith((sql) => sql.includes("FROM code_comments WHERE id")
      ? { rows: [{ id: commentId, section_key: "dao-code-1", parent_id: null,
          author_id: actor, deleted_at: null, hidden_at: null, pinned_at: null }] } : { rows: [] });
    await changeCodeCommentWithDatabase(owner.database, actor, false, {
      action: "delete", section: "dao-code-1", commentId,
    });
    expect(owner.calls.some((call) => call.sql.includes("SET body = NULL, deleted_at = now()"))).toBe(true);
    expect(owner.calls.some((call) => call.sql.includes("DELETE FROM code_comments"))).toBe(false);
    await expect(changeCodeCommentWithDatabase(owner.database, actor, false, {
      action: "helpful", section: "dao-code-1", commentId,
    })).rejects.toBeInstanceOf(CodeCommentAccessError);
    await expect(changeCodeCommentWithDatabase(owner.database, other, false, {
      action: "hide", section: "dao-code-1", commentId, reason: "Причина",
    })).rejects.toBeInstanceOf(CodeCommentAccessError);
    const admin = databaseWith((sql) => sql.includes("FROM code_comments WHERE id")
      ? { rows: [{ id: commentId, section_key: "dao-code-1", parent_id: null,
          author_id: actor, deleted_at: null, hidden_at: null, pinned_at: null }] } : { rows: [] });
    await changeCodeCommentWithDatabase(admin.database, other, true, {
      action: "hide", section: "dao-code-1", commentId, reason: "Причина",
    });
    expect(admin.calls.some((call) => call.sql.includes("SET hidden_at = now()") && call.values?.[2] === "Причина")).toBe(true);
  });

  it("validates section, IDs, and text length before opening a transaction", async () => {
    const { database, calls } = databaseWith(() => ({ rows: [] }));
    await expect(changeCodeCommentWithDatabase(database, actor, false, {
      action: "create", section: "wrong", body: "Текст",
    })).rejects.toBeInstanceOf(CodeCommentValidationError);
    await expect(changeCodeCommentWithDatabase(database, actor, false, {
      action: "create", section: "dao-code-1", body: " ",
    })).rejects.toBeInstanceOf(CodeCommentValidationError);
    await expect(changeCodeCommentWithDatabase(database, actor, false, {
      action: "delete", section: "dao-code-1", commentId: "../x",
    })).rejects.toBeInstanceOf(CodeCommentValidationError);
    expect(calls).toEqual([]);
  });
});
