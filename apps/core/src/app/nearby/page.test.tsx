import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(), listResidenceCommunities: vi.fn(), readInterfaceTexts: vi.fn(), redirect: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/communities", () => ({ listResidenceCommunities: mocks.listResidenceCommunities }));
vi.mock("@/lib/interface-texts", () => ({ readInterfaceTexts: mocks.readInterfaceTexts }));
vi.mock("@/lib/profile-about", () => ({
  residenceLabel: ({ name, country }: { name: string; country: string }) => `${name}, ${country}`,
}));

import NearbyPage from "./page";

function content(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(content).join(" ");
  if (!isValidElement(node)) return "";
  return content((node.props as { children?: ReactNode }).children);
}

function propsWithHref(node: ReactNode): Array<{ href: string; children: ReactNode }> {
  if (Array.isArray(node)) return node.flatMap(propsWithHref);
  if (!isValidElement(node)) return [];
  const props = node.props as { href?: string; children?: ReactNode };
  return [...(props.href ? [{ href: props.href, children: props.children }] : []), ...propsWithHref(props.children)];
}

function hasNearbyNavigation(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(hasNearbyNavigation);
  if (!isValidElement(node)) return false;
  const props = node.props as { current?: string; children?: ReactNode };
  return props.current === "nearby" || hasNearbyNavigation(props.children);
}

describe("/nearby", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((destination: string) => { throw new Error(`redirect:${destination}`); });
    mocks.readInterfaceTexts.mockResolvedValue({ values: {
      "nearby.title": "Рядом", "nearby.lead": "Участники ДАО по месту жительства.",
      "nearby.empty": "Пусто",
    } });
  });

  it("requires a signed-in Participant before reading communities", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    await expect(NearbyPage()).rejects.toThrow("redirect:/");
    expect(mocks.listResidenceCommunities).not.toHaveBeenCalled();
  });

  it("uses CoreNavigation and keeps each counted residence visible without directory links", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.listResidenceCommunities.mockResolvedValue([
      { residence: { name: "Москва", type: "город", country: "Россия" }, participantCount: 12 },
      { residence: { name: "Казань", type: "город", country: "Россия" }, participantCount: 5 },
    ]);
    const page = await NearbyPage();
    const text = content(page);
    expect(text).toContain("Рядом");
    expect(text).toContain("Участники ДАО по месту жительства.");
    expect(text).toContain("12");
    expect(text).toContain("5");
    expect(propsWithHref(page).map(({ href }) => href)).not.toContain("/participants");
    expect(text).toContain("Москва, Россия");
    expect(hasNearbyNavigation(page)).toBe(true);
  });
});
