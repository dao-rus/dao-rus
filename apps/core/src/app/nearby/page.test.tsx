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
  residenceDirectoryHref: ({ name, type, country }: { name: string; type: string; country: string }) =>
    `/participants?${new URLSearchParams({ residence_name: name, residence_type: type, residence_country: country })}`,
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

  it("uses CoreNavigation and links each counted residence to its existing community", async () => {
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
    const links = propsWithHref(page);
    expect(links.map(({ href }) => href)).toEqual([
      "/participants?residence_name=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0&residence_type=%D0%B3%D0%BE%D1%80%D0%BE%D0%B4&residence_country=%D0%A0%D0%BE%D1%81%D1%81%D0%B8%D1%8F",
      "/participants?residence_name=%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%8C&residence_type=%D0%B3%D0%BE%D1%80%D0%BE%D0%B4&residence_country=%D0%A0%D0%BE%D1%81%D1%81%D0%B8%D1%8F",
    ]);
    expect(content(links[0].children)).toBe("Москва, Россия");
    expect(hasNearbyNavigation(page)).toBe(true);
  });
});
