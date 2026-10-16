import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  readInterfaceTexts: vi.fn(),
  getOnboardingQuests: vi.fn(),
  countUnreadNotifications: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/interface-texts", () => ({ readInterfaceTexts: mocks.readInterfaceTexts }));
vi.mock("@/lib/onboarding-quests", () => ({ getOnboardingQuests: mocks.getOnboardingQuests }));
vi.mock("../lib/notifications", () => ({ countUnreadNotifications: mocks.countUnreadNotifications }));
vi.mock("@/lib/config", () => ({
  isTelegramConfigured: () => true,
  devAuthEnabled: () => false,
  isParticipantsDirectoryEnabled: () => false,
}));

import Home from "./page";
import { PrivateMessagesLink } from "../components/private-messages-link";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

function links(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(links);
  if (!isValidElement(node)) return [];
  if (node.type === PrivateMessagesLink) return links(PrivateMessagesLink(node.props as Parameters<typeof PrivateMessagesLink>[0]));
  const props = node.props as { href?: string; children?: ReactNode };
  return [...(props.href ? [props.href] : []), ...links(props.children)];
}

function actionLinks(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(actionLinks);
  if (!isValidElement(node)) return [];
  const props = node.props as { className?: string; children?: ReactNode };
  return props.className === "actions" ? links(props.children) : actionLinks(props.children);
}

function actionLinkClass(node: ReactNode, href: string): string | undefined {
  if (Array.isArray(node)) return node.map((item) => actionLinkClass(item, href)).find(Boolean);
  if (!isValidElement(node)) return undefined;
  const props = node.props as { className?: string; href?: string; children?: ReactNode };
  if (props.className === "actions") {
    const children = Array.isArray(props.children) ? props.children : [props.children];
    return children.find((child) => isValidElement(child) && (child.props as { href?: string }).href === href)
      ?.props.className;
  }
  return actionLinkClass(props.children, href);
}

describe("home interface texts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.countUnreadNotifications.mockResolvedValue(0);
    mocks.getOnboardingQuests.mockResolvedValue([{ sourceType: "interest_first_added", textKey: "onboarding.interest", href: "/profile#profile-interests", amount: "0.100000" }]);
    mocks.readInterfaceTexts.mockResolvedValue({ values: {
      "home.eyebrow": "Своя надпись",
      "home.title": "Свой заголовок",
      "home.lead": "Свой основной текст",
      "home.login_button": "Свой вход",
      "home.profile_button": "Профиль",
      "home.code_link": "Открыть наш Кодекс",
      "home.code_title": "Кодекс руси",
      "onboarding.interest": "Добавьте интерес, чтобы найти единомышленников",
      "participants.title": "Моя сеть",
      "nearby.title": "Рядом",
      "exchange.title": "Обмен",
      "nav.home": "Главная",
      "nav.veche": "Наше вече",
      "nav.private_messages": "Личка",
    } });
  });

  it("shows overridden texts to a visitor", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    const page = await Home({ searchParams: Promise.resolve({}) });
    const text = textContent(page);
    expect(text).not.toContain("Своя надпись");
    expect(text.indexOf("Кодекс руси")).toBeLessThan(text.indexOf("Свой заголовок"));
    expect(text).toContain("Свой заголовок");
    expect(text).toContain("Свой основной текст");
    expect(text).toContain("Свой вход");
    expect(text).toContain("Не нападай первым.");
    expect(text).toContain("Власть принадлежит народу.");
    expect(text).toContain("Открыть наш Кодекс");
    expect(mocks.getOnboardingQuests).not.toHaveBeenCalled();
    expect(text).not.toContain("DARUS");
    expect(text).not.toContain("Рядом");
    expect(links(page)).not.toContain("/nearby");
    expect(links(page)).not.toContain("/notifications");
    expect(mocks.countUnreadNotifications).not.toHaveBeenCalled();
  });

  it("shows the requested navigation order after login", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "participant" });
    const page = await Home({ searchParams: Promise.resolve({}) });
    expect(textContent(page)).toContain("Профиль");
    expect(textContent(page)).not.toContain("Моя сеть");
    expect(textContent(page)).toContain("Рядом");
    expect(links(page)).toContain("/nearby");
    expect(actionLinks(page)).toEqual(["/veche", "/exchange", "/nearby", "/notifications", "/profile"]);
    expect(actionLinkClass(page, "/profile")).toBe("button secondary");
    expect(mocks.countUnreadNotifications).toHaveBeenCalledWith("participant");
    expect(textContent(page)).toContain("Обмен");
    expect(textContent(page)).toContain("Наше вече");
    expect(textContent(page).indexOf("Наше вече")).toBeLessThan(
      textContent(page).indexOf("Добавьте интерес, чтобы найти единомышленников"),
    );
    expect(textContent(page)).toContain("0,1");
  });

  it("marks the final personal messages button when notifications are unread", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "participant" });
    mocks.countUnreadNotifications.mockResolvedValue(2);
    const page = await Home({ searchParams: Promise.resolve({}) });
    const actions = (page.props.children as ReactNode);
    expect(actionLinks(page).at(-2)).toBe("/notifications");
    function findPrivateMessages(node: ReactNode): ReactNode | null {
      if (Array.isArray(node)) return node.map(findPrivateMessages).find(Boolean) ?? null;
      if (!isValidElement(node)) return null;
      if (node.type === PrivateMessagesLink) return node;
      return findPrivateMessages((node.props as { children?: ReactNode }).children);
    }
    const link = findPrivateMessages(actions);
    expect(isValidElement(link) && (link.props as { unreadCount: number }).unreadCount).toBe(2);
  });
});
