import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentParticipant: vi.fn(), listNotifications: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/notifications", () => ({ listNotifications: mocks.listNotifications }));
vi.mock("../../components/local-date-time", () => ({ LocalDateTime: ({ value }: { value: string }) => value }));

import NotificationsPage from "./page";

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

describe("/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });

  it("rejects unauthenticated access before querying notifications", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    await expect(NotificationsPage()).rejects.toThrow("redirect:/");
    expect(mocks.listNotifications).not.toHaveBeenCalled();
  });

  it("shows only the current participant's notifications and action link", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "recipient" });
    mocks.listNotifications.mockResolvedValue([{ id: "note-1", text: "Ваше уведомление", actionUrl: "/need",
      createdAt: new Date("2026-10-04T12:00:00Z"), readAt: null }]);
    const page = await NotificationsPage();
    expect(mocks.listNotifications).toHaveBeenCalledWith("recipient");
    expect(textOf(page)).toContain("Ваше уведомление");
    expect(propsOf(page).some((props) => props.href === "/need")).toBe(true);
    expect(propsOf(page).some((props) => props.action === "/api/notifications/read")).toBe(true);
  });

  it("shows an ordinary empty state", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "recipient" });
    mocks.listNotifications.mockResolvedValue([]);
    expect(textOf(await NotificationsPage())).toContain("Уведомлений пока нет.");
  });
});
