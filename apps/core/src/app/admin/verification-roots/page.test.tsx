import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), roots: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.session }));
vi.mock("@/lib/config", () => ({ hasPrototypeAdminAccess: mocks.admin }));
vi.mock("@/lib/verification", () => ({ listVerificationRoots: mocks.roots }));
vi.mock("../../../components/core-navigation", () => ({ CoreNavigation: () => null }));
import Page from "./page";

function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : "";
}

describe("/admin/verification-roots", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.session.mockResolvedValue({ id: "a" }); mocks.admin.mockReturnValue(true);
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });

  it("checks the administrator before reading the list", async () => {
    mocks.session.mockResolvedValueOnce(null); await expect(Page()).rejects.toThrow("redirect:/");
    mocks.admin.mockReturnValueOnce(false); await expect(Page()).rejects.toThrow("redirect:/profile");
    expect(mocks.roots).not.toHaveBeenCalled();
  });

  it("lists the roots with who added them", async () => {
    mocks.roots.mockResolvedValue([{ subjectId: "r1", displayName: "Ван", addedAt: new Date("2026-01-05T09:00:00Z"), addedByName: "Ван" }]);
    const content = text(await Page()).replace(/\s+/gu, " ");
    expect(content).toContain("Сейчас в ядре: 1"); expect(content).toContain("Ван");
  });

  it("says when nobody is there yet", async () => {
    mocks.roots.mockResolvedValue([]);
    expect(text(await Page())).toContain("Начальное ядро пока пусто.");
  });
});
