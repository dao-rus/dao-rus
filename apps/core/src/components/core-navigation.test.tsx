import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { interfaceTextFields, type InterfaceTextValues } from "../lib/interface-texts";
import { PrivateMessagesLink } from "./private-messages-link";
import { CoreNavigation } from "./core-navigation";

const mocks = vi.hoisted(() => ({ getCurrentParticipant: vi.fn(), countUnreadNotifications: vi.fn() }));
vi.mock("../lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("../lib/notifications", () => ({ countUnreadNotifications: mocks.countUnreadNotifications }));

function links(node: ReactNode): Array<{ href: string; label: string; current?: string; hasUnread?: boolean }> {
  if (Array.isArray(node)) return node.flatMap(links);
  if (!isValidElement(node)) return [];
  if (node.type === PrivateMessagesLink) return links(PrivateMessagesLink(node.props as Parameters<typeof PrivateMessagesLink>[0]));
  const props = node.props as { href?: string; children?: ReactNode; "aria-current"?: string; "data-has-unread"?: boolean };
  return [
    ...(props.href ? [{ href: props.href, label: textOf(props.children), current: props["aria-current"],
      ...(props["data-has-unread"] !== undefined ? { hasUnread: props["data-has-unread"] } : {}) }] : []),
    ...links(props.children),
  ];
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (!isValidElement(node)) return "";
  return textOf((node.props as { children?: ReactNode }).children);
}

describe("CoreNavigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentParticipant.mockResolvedValue({ id: "participant" });
    mocks.countUnreadNotifications.mockResolvedValue(0);
  });
  it("links all main sections, respects editable labels and marks the current one", async () => {
    const texts = Object.fromEntries(interfaceTextFields.map((field) => [field.key, field.defaultValue])) as InterfaceTextValues;
    texts["participants.title"] = "Люди";
    texts["exchange.title"] = "Обмен";

    const navigation = await CoreNavigation({ current: "profile", texts });

    expect((navigation.props as { "aria-label": string })["aria-label"]).toBe("Основные разделы");
    expect(links(navigation)).toEqual([
      { href: "/", label: "Главная", current: undefined },
      { href: "/veche", label: "Вече", current: undefined },
      { href: "/participants", label: "Люди", current: undefined },
      { href: "/exchange", label: "Обмен", current: undefined },
      { href: "/nearby", label: "Рядом", current: undefined },
      { href: "/notifications", label: "✉Личка", current: undefined, hasUnread: false },
      { href: "/profile", label: "Профиль", current: "page" },
    ]);
    expect(mocks.countUnreadNotifications).toHaveBeenCalledWith("participant");
  });

  it("marks Nearby as the current section", async () => {
    const texts = Object.fromEntries(interfaceTextFields.map((field) => [field.key, field.defaultValue])) as InterfaceTextValues;
    const navigation = await CoreNavigation({ current: "nearby", texts });
    expect(links(navigation).find((link) => link.href === "/nearby")).toEqual({
      href: "/nearby", label: "Рядом", current: "page",
    });
  });

  it("marks the final personal messages link when there are unread notifications", async () => {
    mocks.countUnreadNotifications.mockResolvedValue(2);
    const texts = Object.fromEntries(interfaceTextFields.map((field) => [field.key, field.defaultValue])) as InterfaceTextValues;
    const navigation = await CoreNavigation({ current: "notifications", texts });
    expect(links(navigation).at(-2)).toEqual({ href: "/notifications", label: "✉Личка", current: "page", hasUnread: true });
    expect(links(navigation).at(-1)?.href).toBe("/profile");
  });
});
