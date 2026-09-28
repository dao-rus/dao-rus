import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  participant: vi.fn(),
  encounter: vi.fn(),
  messages: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("@/lib/relay", () => ({
  getRelayEncounter: mocks.encounter,
  listRelayMessages: mocks.messages,
  RelayValidationError: class RelayValidationError extends Error {},
}));

import RelayDetailPage from "./page";

const encounterId = "50000000-0000-4000-8000-000000000005";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}
function findProps(node: ReactNode, matches: (props: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findProps(child, matches));
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [...(matches(props) ? [props] : []), ...findProps(props.children as ReactNode, matches)];
}

describe("anonymous relay dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.participant.mockResolvedValue({ id: "viewer" });
    mocks.messages.mockResolvedValue([{ id: "message", body: "Здравствуйте", mine: false }]);
  });

  it("keeps names and profile links hidden with one consent", async () => {
    mocks.encounter.mockResolvedValue({
      id: encounterId, kind: "need", body: "Нужна помощь", status: "active",
      role: "author", myConsent: true, other: null,
    });
    const page = await RelayDetailPage({ params: Promise.resolve({ id: encounterId }) });
    expect(textContent(page)).toContain("Ожидаем вторую сторону");
    expect(textContent(page)).toContain("Откликнувшийся");
    expect(findProps(page, (props) => String(props.href ?? "").startsWith("/profile/"))).toHaveLength(0);
    expect(findProps(page, (props) => props.action === "/api/relay")).toHaveLength(2);
  });

  it("shows the other participant only after mutual reveal", async () => {
    mocks.encounter.mockResolvedValue({
      id: encounterId, kind: "need", body: "Нужна помощь", status: "revealed",
      role: "author", myConsent: true,
      other: { id: "other-id", name: "Борис", username: "boris" },
    });
    const page = await RelayDetailPage({ params: Promise.resolve({ id: encounterId }) });
    expect(textContent(page)).toContain("Борис");
    expect(textContent(page).replace(/\s+/g, "")).toContain("@boris");
    expect(findProps(page, (props) => props.href === "/profile/other-id")).toHaveLength(1);
  });

  it("renders cancelled history without message or consent actions and without identity", async () => {
    mocks.encounter.mockResolvedValue({
      id: encounterId, kind: "need", body: "Нужна помощь", status: "cancelled",
      role: "author", myConsent: true, other: null,
    });
    const page = await RelayDetailPage({ params: Promise.resolve({ id: encounterId }) });
    expect(textContent(page)).toContain("Контакты не раскрываются");
    expect(findProps(page, (props) => props.action === "/api/relay")).toHaveLength(0);
    expect(findProps(page, (props) => String(props.href ?? "").startsWith("/profile/"))).toHaveLength(0);
  });
});
