import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ getCurrentParticipant: async () => null }));
vi.mock("@/lib/config", () => ({ hasPrototypeAdminAccess: () => false }));
vi.mock("../../lib/code-comments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/code-comments")>();
  return { ...actual, listCodeComments: async () => [] };
});
import CodePage from "./page";

describe("/code", () => {
  it("opens the section specified by a notification deep link", async () => {
    const html = renderToStaticMarkup(await CodePage({ searchParams: Promise.resolve({ section: "dao-code-all" }) }));
    expect(html.match(/<details\b[^>]*\bopen=""/g)).toHaveLength(1);
    expect(html.slice(html.indexOf('id="dao-code-all"'))).toMatch(/<details\b[^>]*\bopen=""/);
  });
  it("renders the unchanged three clauses and four discussions for a visitor", async () => {
    const html = renderToStaticMarkup(await CodePage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Не нападай первым.");
    expect(html).toContain("Стой за свою свободу, уважай чужую. Границы свобод определяют договор и вече.");
    expect(html).toContain("Власть принадлежит народу.");
    expect((html.match(/Обсуждение · 0/g) ?? [])).toHaveLength(4);
    expect(html).not.toContain('action="/api/code/comments"');
  });
});

vi.mock("@/lib/award-views", () => ({ getAwardBadges: vi.fn().mockResolvedValue({}), getOwnAwardOffers: vi.fn().mockResolvedValue([]) }));
