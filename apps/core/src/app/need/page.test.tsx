import { isValidElement, type ReactElement, type ReactNode } from "react";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentParticipant: vi.fn(), addProfileSignal: vi.fn(), readInterfaceTexts: vi.fn() }));

vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/interface-texts", () => ({ readInterfaceTexts: mocks.readInterfaceTexts }));
vi.mock("@/lib/config", () => ({ isTelegramConfigured: () => true, appBaseUrl: () => "https://core.daorus.org" }));
vi.mock("@/lib/profile-about", () => ({
  addProfileSignal: mocks.addProfileSignal,
  ProfileAboutValidationError: class ProfileAboutValidationError extends Error {},
}));

import NeedPage from "./page";
import { POST } from "../api/need/route";
import { NeedAuthGate, telegramEntryMode } from "./need-auth-gate";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

function findProps(node: ReactNode, matches: (props: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProps(child, matches);
      if (found) return found;
    }
  }
  if (!isValidElement(node)) return null;
  const props = node.props as Record<string, unknown>;
  return matches(props) ? props : findProps(props.children as ReactNode, matches);
}

function findElement(node: ReactNode, matches: (element: ReactElement) => boolean): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, matches);
      if (found) return found;
    }
  }
  if (!isValidElement(node)) return null;
  if (matches(node)) return node;
  return findElement((node.props as { children?: ReactNode }).children, matches);
}

describe("/need entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readInterfaceTexts.mockResolvedValue({ values: {
      "need.title": "Что вам нужно?",
      "need.lead": "Опишите потребность своими словами. Запись появится в вашем профиле.",
      "exchange.title": "Нужно / есть",
    } });
  });

  it("asks the question and offers direct login to the same screen", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    const page = await NeedPage({ searchParams: Promise.resolve({}) });
    expect(textContent(page)).toContain("Что вам нужно?");
    expect(findProps(page, (props) => props.href === "/api/auth/telegram/start?next=%2Fneed")).not.toBeNull();
    expect(telegramEntryMode(undefined)).toBe("browser");
    expect(telegramEntryMode("")).toBe("browser");
    expect(telegramEntryMode("signed-data")).toBe("mini_app");
  });

  it("uses the edited Need title and lead", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "participant-id" });
    mocks.readInterfaceTexts.mockResolvedValue({ values: {
      "need.title": "Расскажите, что нужно",
      "need.lead": "Свободный текст потребности",
      "exchange.title": "Обмен",
    } });
    const page = await NeedPage({ searchParams: Promise.resolve({}) });
    expect(textContent(page)).toContain("Расскажите, что нужно");
    expect(textContent(page)).toContain("Свободный текст потребности");
    expect(textContent(page)).toContain("Обмен");
  });
  it("shows a prominent confirmation and blank next form after a successful Mini App Need save", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "participant-id" });
    mocks.addProfileSignal.mockResolvedValue(undefined);
    const response = await POST(new NextRequest("https://core.daorus.org/api/need", {
      method: "POST",
      body: new URLSearchParams({ body: "Нужна помощь с проектом", visibility: "members" }),
    }));
    expect(mocks.addProfileSignal).toHaveBeenCalledWith(
      "participant-id", "need", "Нужна помощь с проектом", "members",
    );
    expect(response.status).toBe(303);
    const redirect = new URL(response.headers.get("location") ?? "");
    expect(redirect.pathname).toBe("/need");
    expect(redirect.searchParams.get("saved")).toBe("1");

    const page = await NeedPage({
      searchParams: Promise.resolve({ saved: redirect.searchParams.get("saved") ?? undefined }),
    });
    expect(findElement(page, (element) => element.type === NeedAuthGate)).not.toBeNull();
    const notice = findProps(page, (props) => props.id === "need-saved");
    expect(notice).toMatchObject({ className: "needSavedNotice", role: "status" });
    expect(textContent(notice?.children as ReactNode)).toContain("✓ Запись сохранена");
    expect(findProps(notice?.children as ReactNode, (props) =>
      props.href === "/profile" && props.children === "Посмотреть в профиле"
    )).not.toBeNull();
    const form = findElement(page, (element) =>
      (element.props as { action?: string }).action === "/api/need"
    );
    expect(form?.key).toBe("after-save");
    const textarea = findProps(form, (props) => props.name === "body");
    expect(textarea?.value).toBeUndefined();
    expect(textarea?.defaultValue).toBeUndefined();
    expect(findProps(form, (props) => props.name === "visibility")?.defaultValue).toBe("members");
  });
});
