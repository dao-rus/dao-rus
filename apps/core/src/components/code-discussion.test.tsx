import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodeDiscussion } from "./code-discussion";
import type { CodeComment } from "../lib/code-comments";

function entry(id: string, parentId: string | null, body: string | null, flags: Partial<CodeComment> = {}): CodeComment {
  return { id, parentId, section: "dao-code-1", authorId: "10000000-0000-4000-8000-000000000001",
    authorName: "Алиса", verificationPoints: 2, positiveCount: 3, body,
    deleted: false, hidden: false, hiddenReason: null, pinned: false,
    helpfulCount: 0, helpedByViewer: false,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"), ...flags };
}

describe("code discussion markup", () => {
  it("keeps an anonymous discussion readable without write controls or concealed body", () => {
    const comments = [
      entry("a", null, null, { deleted: true }),
      entry("b", "a", "Сохранённый ответ"),
      entry("c", null, null, { hidden: true, hiddenReason: "Причина" }),
    ];
    const html = renderToStaticMarkup(
      <CodeDiscussion section="dao-code-1" comments={comments} sort="latest"
        viewerId={null} isAdmin={false} initiallyOpen={true} />,
    );
    expect(html).toContain("Обсуждение · 1");
    expect(html).toContain("Комментарий удалён автором.");
    expect(html).toContain("Сохранённый ответ");
    expect(html).toContain("Причина: Причина");
    expect(html).not.toContain('action="/api/code/comments"');
    expect(html).toContain('href="/code?sort=top&amp;section=dao-code-1#dao-code-1"');
  });

  it("shows one reply level, author tools and admin moderation controls", () => {
    const comments = [entry("a", null, "Комментарий"), entry("b", "a", "Ответ")];
    const html = renderToStaticMarkup(
      <CodeDiscussion section="dao-code-1" comments={comments} sort="top"
        viewerId="10000000-0000-4000-8000-000000000001" isAdmin={true} initiallyOpen={true} />,
    );
    expect(html).toContain("Комментарий");
    expect(html).toContain("Ответ");
    expect(html).toContain("Редактировать");
    expect(html).toContain("Закрепить");
    expect(html).toContain("Причина скрытия");
    expect(html).toContain('name="parent_id" value="a"');
    expect(html).not.toContain('name="parent_id" value="b"');
  });
});
