import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  hasPrototypeAdminAccess: vi.fn(),
  readInterfaceTexts: vi.fn(),
  redirect: vi.fn(),
  fields: [
    { section: "Главная", key: "home.title", label: "Заголовок", defaultValue: "ДАО Русь", multiline: false },
    { section: "Нужно / есть", key: "exchange.title", label: "Заголовок", defaultValue: "Нужно / есть", multiline: false },
    { section: "Нужно / есть", key: "exchange.lead", label: "Вводный текст", defaultValue: "Текст", multiline: true },
    { section: "Мне нужно", key: "need.title", label: "Заголовок", defaultValue: "Что вам нужно?", multiline: false },
  ],
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/config", () => ({ hasPrototypeAdminAccess: mocks.hasPrototypeAdminAccess }));
vi.mock("@/lib/interface-texts", () => ({
  interfaceTextFields: mocks.fields,
  readInterfaceTexts: mocks.readInterfaceTexts,
}));

import InterfacePage from "./page";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

function collectProps(node: ReactNode, matches: (props: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap((child) => collectProps(child, matches));
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [...(matches(props) ? [props] : []), ...collectProps(props.children as ReactNode, matches)];
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

  it("groups all fields from registry metadata without a separate admin field list", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "admin" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(true);
    mocks.readInterfaceTexts.mockResolvedValue({
      values: Object.fromEntries(mocks.fields.map((field) => [field.key, field.defaultValue])),
      overrides: Object.fromEntries(mocks.fields.map((field) => [field.key, null])),
    });

    const page = await InterfacePage({ searchParams: Promise.resolve({}) });
    const text = textContent(page);
    expect(text).toContain("Пользовательские тексты разделов DAO Core");
    expect(text).not.toContain("Тексты главной страницы");
    for (const section of new Set(mocks.fields.map((field) => field.section))) {
      expect(text).toContain(section);
    }
    const names = collectProps(page, (props) => mocks.fields.some((field) => field.key === props.name))
      .map((props) => props.name);
    expect(names).toEqual(mocks.fields.map((field) => field.key));
    expect(text).toContain("Сохранить тексты");
  });
});
