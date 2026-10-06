import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  hasPrototypeAdminAccess: vi.fn(),
  readInterfaceTexts: vi.fn(),
  redirect: vi.fn(),
  fields: [
    { section: "Главная", key: "home.title", label: "Заголовок", defaultValue: "ДАО Русь", multiline: false, pageLabel: "Главная", pageHref: "/" },
    { section: "Обмен", key: "exchange.title", label: "Заголовок", defaultValue: "Обмен", multiline: false, pageLabel: "Обмен", pageHref: "/exchange" },
    { section: "Обмен", key: "exchange.lead", label: "Вводный текст", defaultValue: "Текст", multiline: true, pageLabel: "Обмен", pageHref: "/exchange" },
    { section: "Сигналы", key: "signal.new_title", label: "Новый сигнал", defaultValue: "Новый сигнал", multiline: false, pageLabel: "Создание сигнала", pageHref: "/exchange/new" },
    { section: "Навигация", key: "nav.home", label: "Главная", defaultValue: "Главная", multiline: false, pageLabel: "Общий интерфейс", pageHref: undefined },
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

function contextForField(page: ReactNode, key: string) {
  const field = collectProps(page, (props) => props.className === "interfaceField")
    .find((props) => collectProps(props.children as ReactNode, (child) => child.name === key).length);
  expect(field).toBeDefined();
  const context = collectProps(field!.children as ReactNode,
    (props) => props.className === "interfaceFieldContext")[0];
  expect(context).toBeDefined();
  return {
    text: textContent(context.children as ReactNode),
    links: collectProps(context.children as ReactNode, (props) => typeof props.href === "string"),
    firstChild: Array.isArray(field!.children) ? field!.children[0] : null,
  };
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
    expect(collectProps(page, (props) => props.maxLength !== undefined)).toEqual([]);
    expect(text).toContain("Сохранить тексты");
  });

  it("shows linked page context above fields, including repeated pages and a route-free shared field", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "admin" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(true);
    mocks.readInterfaceTexts.mockResolvedValue({
      values: Object.fromEntries(mocks.fields.map((field) => [field.key, field.defaultValue])),
      overrides: Object.fromEntries(mocks.fields.map((field) => [field.key, null])),
    });

    const page = await InterfacePage({ searchParams: Promise.resolve({}) });
    for (const key of ["exchange.title", "exchange.lead"]) {
      const context = contextForField(page, key);
      expect(context.text).toContain("Обмен");
      expect(context.links.map((link) => link.href)).toEqual(["/exchange"]);
      expect(isValidElement(context.firstChild)).toBe(true);
      expect((context.firstChild as { props: { className: string } }).props.className)
        .toBe("interfaceFieldContext");
    }
    expect(contextForField(page, "signal.new_title").links[0].href).toBe("/exchange/new");
    const shared = contextForField(page, "nav.home");
    expect(shared.text).toContain("Общий интерфейс");
    expect(shared.links).toEqual([]);
  });
});
