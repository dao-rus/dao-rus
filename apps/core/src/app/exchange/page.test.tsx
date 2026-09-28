import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  participant: vi.fn(),
  signals: vi.fn(),
  encounters: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("@/lib/relay", () => ({
  listBlindSignals: mocks.signals,
  listRelayEncounters: mocks.encounters,
}));

import ExchangePage from "./page";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

function collectProps(node: ReactNode, matches: (props: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap((child) => collectProps(child, matches));
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [...(matches(props) ? [props] : []), ...collectProps(props.children as ReactNode, matches)];
}

describe("anonymous Need/Have catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.participant.mockResolvedValue({ id: "viewer" });
    mocks.encounters.mockResolvedValue([]);
  });

  it("shows only safe text and own marker, and never offers self-response", async () => {
    mocks.signals.mockResolvedValue([
      { id: "own", kind: "need", body: "Мой запрос", mine: true },
      { id: "other", kind: "need", body: "Чужой запрос", mine: false },
    ]);
    const page = await ExchangePage({ searchParams: Promise.resolve({ tab: "need" }) });
    expect(textContent(page)).toContain("Мой запрос");
    expect(textContent(page)).toContain("Ваш сигнал");
    expect(textContent(page)).toContain("Чужой запрос");
    const responses = collectProps(page, (props) => props.action === "/api/relay");
    expect(responses).toHaveLength(1);
    expect(collectProps(responses[0].children as ReactNode, (props) => props.name === "signal_id")?.[0]?.value)
      .toBe("other");
    expect(collectProps(page, (props) => String(props.href ?? "").startsWith("/profile/"))).toHaveLength(0);
  });

  it("requests only have signals for the second tab", async () => {
    mocks.signals.mockResolvedValue([]);
    await ExchangePage({ searchParams: Promise.resolve({ tab: "have" }) });
    expect(mocks.signals).toHaveBeenCalledWith("viewer", "have");
  });
});
