import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentParticipant: vi.fn() }));

vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/config", () => ({ isTelegramConfigured: () => true }));

import NeedPage from "./page";

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

describe("/need entry", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks the question and offers direct login to the same screen", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    const page = await NeedPage({ searchParams: Promise.resolve({}) });
    expect(textContent(page)).toContain("Что вам нужно?");
    expect(findProps(page, (props) => props.href === "/api/auth/telegram/start?next=%2Fneed")).not.toBeNull();
  });

  it("shows the existing members default and a clear save confirmation", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "participant-id" });
    const page = await NeedPage({ searchParams: Promise.resolve({ saved: "1" }) });
    expect(textContent(page)).toContain("Потребность сохранена.");
    expect(findProps(page, (props) => props.action === "/api/need")).not.toBeNull();
    expect(findProps(page, (props) => props.name === "visibility")?.defaultValue).toBe("members");
  });
});
