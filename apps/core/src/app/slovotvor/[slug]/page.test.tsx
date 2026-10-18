import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  getSlovotvorWordBySlug: vi.fn(),
  getSlovotvorWordById: vi.fn(),
  listSlovotvorVariants: vi.fn(),
  getSlovotvorVoteSummary: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/config", () => ({ appBaseUrl: () => "https://core.daorus.org" }));
vi.mock("@/lib/signal-share", () => ({
  copySignalShareUrl: vi.fn(),
  tryNativeSignalShare: vi.fn(),
}));
vi.mock("@/lib/slovotvor", () => ({
  getSlovotvorWordBySlug: mocks.getSlovotvorWordBySlug,
  getSlovotvorWordById: mocks.getSlovotvorWordById,
  listSlovotvorVariants: mocks.listSlovotvorVariants,
  getSlovotvorVoteSummary: mocks.getSlovotvorVoteSummary,
}));

import SlovotvorWordPage from "./page";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

function findProps(node: ReactNode, matches: (props: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProps(child, matches);
      if (found) return found;
    }
  }
  if (!isValidElement(node)) return null;
  const props = node.props as Record<string, unknown>;
  return matches(props) ? props : findProps(props.children as ReactNode, matches);
}

const task = {
  id: "42a8c373-486f-4ebc-bc06-24dcd2a2f8c6", word: null, sourceWord: "промпт", explanation: null,
  authorId: "author-id", authorName: "Автор", parentId: null, slug: "prompt",
  createdAt: new Date(), betterVotes: 0, worseVotes: 0,
};

describe("Slovotvor task cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentParticipant.mockResolvedValue(null);
    mocks.getSlovotvorVoteSummary.mockResolvedValue({ better: 0, worse: 0, ownVote: null });
    mocks.getSlovotvorWordById.mockResolvedValue(null);
  });

  it("shows the replacement task and its empty variant state", async () => {
    mocks.getSlovotvorWordBySlug.mockResolvedValue(task);
    mocks.listSlovotvorVariants.mockResolvedValue([]);

    const page = await SlovotvorWordPage({ params: Promise.resolve({ slug: "prompt" }) });

    expect(textContent(page)).toContain("промпт");
    expect(textContent(page)).toContain("Придумай лучше!");
    expect(textContent(page)).toContain("Предложить замену");
    expect(textContent(page)).toContain("Пока нет предложений. Можно стать первым");
    expect(findProps(page, (props) => props.href === `/slovotvor?parent=${task.id}`)).not.toBeNull();
  });

  it("keeps a published variant linked to its parent task", async () => {
    const variant = { ...task, id: "variant-id", word: "промысло", sourceWord: "промпт", parentId: task.id, slug: "promyslo" };
    mocks.getSlovotvorWordBySlug.mockResolvedValue(variant);
    mocks.getSlovotvorWordById.mockResolvedValue(task);

    const page = await SlovotvorWordPage({ params: Promise.resolve({ slug: "promyslo" }) });

    expect(textContent(page)).toContain("← К исходному заданию");
    expect(findProps(page, (props) => props.href === "/slovotvor/prompt")).not.toBeNull();
    expect(mocks.listSlovotvorVariants).not.toHaveBeenCalled();
  });
});
