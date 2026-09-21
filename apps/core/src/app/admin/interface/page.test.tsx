import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  hasPrototypeAdminAccess: vi.fn(),
  readInterfaceTexts: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/config", () => ({ hasPrototypeAdminAccess: mocks.hasPrototypeAdminAccess }));
vi.mock("@/lib/interface-texts", () => ({
  interfaceTextFields: [
    { key: "home.eyebrow", label: "Надпись над заголовком", defaultValue: "Ядро", multiline: false },
    { key: "home.title", label: "Заголовок", defaultValue: "ДАО Русь", multiline: false },
    { key: "home.lead", label: "Основной текст", defaultValue: "Текст", multiline: true },
    { key: "home.login_button", label: "Кнопка входа", defaultValue: "Войти", multiline: false },
    { key: "home.profile_button", label: "Кнопка профиля", defaultValue: "Профиль", multiline: false },
  ],
  readInterfaceTexts: mocks.readInterfaceTexts,
}));

import InterfacePage from "./page";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

describe("/admin/interface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((destination: string) => {
      throw new Error(`redirect:${destination}`);
    });
  });

  it("denies an ordinary participant before reading interface texts", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "ordinary" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(false);

    await expect(InterfacePage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("redirect:/profile");
    expect(mocks.readInterfaceTexts).not.toHaveBeenCalled();
  });

  it("shows five fixed text fields to an admin", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "admin" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(true);
    mocks.readInterfaceTexts.mockResolvedValue({
      values: {
        "home.eyebrow": "Ядро",
        "home.title": "ДАО Русь",
        "home.lead": "Текст",
        "home.login_button": "Войти",
        "home.profile_button": "Профиль",
      },
      overrides: {
        "home.eyebrow": null,
        "home.title": null,
        "home.lead": null,
        "home.login_button": null,
        "home.profile_button": null,
      },
    });

    const page = await InterfacePage({ searchParams: Promise.resolve({}) });
    const text = textContent(page);
    expect(text).toContain("Тексты интерфейса");
    expect(text).toContain("Надпись над заголовком");
    expect(text).toContain("Основной текст");
    expect(text).toContain("Кнопка входа");
    expect(text).toContain("Кнопка профиля");
    expect(text).toContain("Сохранить тексты");
  });
});
