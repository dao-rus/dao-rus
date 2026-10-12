import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { interfaceTextFields } from "../../lib/interface-texts";
const mocks = vi.hoisted(() => ({ participant: vi.fn(), list: vi.fn(), count: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("@/lib/notifications", () => ({ listNotifications: mocks.list, countUnreadNotifications: mocks.count }));
vi.mock("@/lib/interface-texts", () => ({
  readInterfaceTexts: async () => ({ values: Object.fromEntries(interfaceTextFields.map(f => [f.key, f.defaultValue])) }) }));
import Page from "./page";
function propsOf(node: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(propsOf);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [props, ...propsOf(props.children as ReactNode)];
}
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (!isValidElement(node)) return "";
  return textOf((node.props as { children?: ReactNode }).children);
}
const note = { id: "note", text: "Исходный **текст** https://example.org", preview: "Исходный **текст** https://example.org",
  actionUrl: "/need", createdAt: new Date("2026-10-04T12:00:00Z"), readAt: null };
beforeEach(() => {
  vi.clearAllMocks(); mocks.participant.mockResolvedValue({ id: "recipient" });
  mocks.list.mockResolvedValue([note]); mocks.count.mockResolvedValue(1);
  mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
});
describe("notification feed", () => {
  it("requires authentication before reading", async () => {
    mocks.participant.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow("redirect:/");
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("uses an entire native submit button and non-interactive renderer preview", async () => {
    const page = await Page(); const props = propsOf(page);
    expect(mocks.list).toHaveBeenCalledWith("recipient", false);
    expect(props.some(p => p.name === "action" && p.value === "open")).toBe(true);
    expect(props.some(p => p.type === "submit" && p.className === "notificationEntry notificationUnread")).toBe(true);
    expect(props.some(p => p.text === note.preview && p.inline === true && p.preview === true)).toBe(true);
    expect(props.some(p => p.href === "/need")).toBe(false);
    expect(textOf(page)).not.toContain("DAO Core");
    expect(textOf(page)).not.toContain("К профилю");
    expect(textOf(page)).not.toContain("Создано:");
    expect(props.some(p => p.value === "mark_all")).toBe(true);
  });
  it("filters unread with the correct selected state and preserves it on forms", async () => {
    const props = propsOf(await Page({ searchParams: Promise.resolve({ view: "unread" }) }));
    expect(mocks.list).toHaveBeenCalledWith("recipient", true);
    expect(props.find(p => p.href === "/notifications?view=unread")?.["aria-current"]).toBe("page");
    expect(props.find(p => p.href === "/notifications")?.["aria-current"]).toBeUndefined();
    expect(props.some(p => p.name === "view" && p.value === "unread")).toBe(true);
  });
  it("shows a quiet read entry and a separate mark action only for unread unlinked entries", async () => {
    mocks.list.mockResolvedValue([{ ...note, actionUrl: null, preview: null }]);
    expect(propsOf(await Page()).some(p => p.name === "notification_id")).toBe(true);
    mocks.list.mockResolvedValue([{ ...note, actionUrl: null, preview: null, readAt: new Date() }]);
    mocks.count.mockResolvedValue(0);
    const props = propsOf(await Page());
    expect(props.some(p => p.name === "notification_id" || p.value === "mark_all")).toBe(false);
    expect(props.some(p => p.className === "notificationEntry")).toBe(true);
  });
  it("shows empty all/unread states without a mark-all action", async () => {
    mocks.list.mockResolvedValue([]); mocks.count.mockResolvedValue(0);
    expect(textOf(await Page())).toContain("Уведомлений пока нет.");
    expect(textOf(await Page({ searchParams: Promise.resolve({ view: "unread" }) }))).toContain("Непрочитанных уведомлений нет.");
  });
});
