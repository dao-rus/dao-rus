import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), history: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.session }));
vi.mock("@/lib/config", () => ({ hasPrototypeAdminAccess: mocks.admin }));
vi.mock("../../../../lib/guardian-departures", () => ({ getGuardianDepartures: mocks.history }));
vi.mock("../../../../lib/interface-texts", async (original) => { const actual = await original<typeof import("../../../../lib/interface-texts")>();
  return { ...actual, readInterfaceTexts: async () => ({ values: Object.fromEntries(actual.interfaceTextFields.map(f => [f.key, f.defaultValue])), overrides: {} }) }; });
import Page from "./page";
function nodes(node: ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>; return [{ type: node.type, props }, ...nodes(props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : "";
}
describe("Guardian full departure chronology", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ id: "admin" }); mocks.admin.mockReturnValue(true);
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); }); });
  it("uses the same admin guard before reading events", async () => {
    mocks.session.mockResolvedValueOnce(null); await expect(Page()).rejects.toThrow("redirect:/");
    mocks.admin.mockReturnValueOnce(false); await expect(Page()).rejects.toThrow("redirect:/profile");
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it("renders all chronology, both counters, profile links and historical provenance", async () => {
    mocks.history.mockResolvedValue({ total: 2, last30Days: 1, events: [
      { id: "2", participantId: "new", displayName: "Новый", type: "forum.removed", observedAt: new Date("2026-10-05T10:00:00Z") },
      { id: "1", participantId: "old", displayName: "Текущее имя", archivedDisplayName: "Архивное имя", archivedUsername: "@former", type: "forum.left", observedAt: new Date("2020-01-01T10:00:00Z") },
    ] });
    const page = await Page(), content = text(page).replace(/\s+/gu, " ");
    expect(content).toContain("За последние 30 дней: 1"); expect(content).toContain("Всего зарегистрировано убытий: 2");
    expect(content).toContain("Архивное имя"); expect(content).toContain("@former");
    expect(content.indexOf("Новый")).toBeLessThan(content.indexOf("Текущее имя"));
    expect(nodes(page).filter(n => n.props.href).map(n => n.props.href)).toEqual(["/admin/guardian", "/profile/new", "/profile/old"]);
    expect(nodes(page).some(n => typeof n.type === "function" && n.type.name === "CoreNavigation")).toBe(true);
  });
  it("names a placeholder profile by what the person is actually known by", async () => {
    mocks.history.mockResolvedValue({ total: 3, last30Days: 3, events: [
      { id: "3", participantId: "a", displayName: "Участник форума", telegramOwnName: "Ольга Т.", telegramUsername: "olga_t", type: "forum.left", observedAt: new Date("2026-10-05T10:00:00Z") },
      { id: "2", participantId: "b", displayName: "Участник форума", telegramUsername: "only_handle", type: "forum.left", observedAt: new Date("2026-10-04T10:00:00Z") },
      { id: "1", participantId: "c", displayName: "Участник форума", archivedDisplayName: "Имя со скриншота", archivedUsername: "@shot", type: "forum.left", observedAt: new Date("2026-10-03T10:00:00Z") },
    ] });
    const content = text(await Page()).replace(/\s+/gu, " ");
    expect(content).toContain("Ольга Т. · @olga_t");
    expect(content).toContain("@only_handle");
    expect(content).toContain("Имя со скриншота · @shot");
    expect(content).not.toContain("Участник форума");
  });
  it("shows the arrival date when it is known", async () => {
    mocks.history.mockResolvedValue({ total: 2, last30Days: 0, events: [
      { id: "2", participantId: "a", displayName: "Знаем", joinedAt: new Date("2023-10-14T12:00:00Z"), type: "forum.left", observedAt: new Date("2026-10-05T10:00:00Z") },
      { id: "1", participantId: "b", displayName: "Не знаем", joinedAt: null, type: "forum.left", observedAt: new Date("2026-10-04T10:00:00Z") },
    ] });
    const content = text(await Page()).replace(/\s+/gu, " ");
    expect(content).toContain("В ДАО с 14 октября 2023 г.");
    expect(content.match(/В ДАО с/gu)).toHaveLength(1);
  });
  it("renders empty history", async () => {
    mocks.history.mockResolvedValue({ total: 0, last30Days: 0, events: [] });
    expect(text(await Page())).toContain("Зарегистрированных убытий пока нет.");
  });
});
