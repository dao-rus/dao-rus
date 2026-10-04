import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { interfaceTextFields, type InterfaceTextValues } from "../lib/interface-texts";
import { CoreNavigation } from "./core-navigation";

function links(node: ReactNode): Array<{ href: string; label: string; current?: string }> {
  if (Array.isArray(node)) return node.flatMap(links);
  if (!isValidElement(node)) return [];
  const props = node.props as { href?: string; children?: ReactNode; "aria-current"?: string };
  return [
    ...(props.href ? [{ href: props.href, label: String(props.children), current: props["aria-current"] }] : []),
    ...links(props.children),
  ];
}

describe("CoreNavigation", () => {
  it("links all main sections, respects editable labels and marks the current one", async () => {
    const texts = Object.fromEntries(interfaceTextFields.map((field) => [field.key, field.defaultValue])) as InterfaceTextValues;
    texts["participants.title"] = "Люди";
    texts["exchange.title"] = "Обмен";

    const navigation = await CoreNavigation({ current: "profile", texts });

    expect((navigation.props as { "aria-label": string })["aria-label"]).toBe("Основные разделы");
    expect(links(navigation)).toEqual([
      { href: "/", label: "Главная", current: undefined },
      { href: "/veche", label: "Вече", current: undefined },
      { href: "/exchange", label: "Обмен", current: undefined },
      { href: "/participants", label: "Люди", current: undefined },
      { href: "/nearby", label: "Рядом", current: undefined },
      { href: "/profile", label: "Ваш профиль", current: "page" },
      { href: "/notifications", label: "Уведомления", current: undefined },
      { href: "/code", label: "Кодекс", current: undefined },
    ]);
  });

  it("marks Nearby as the current section", async () => {
    const texts = Object.fromEntries(interfaceTextFields.map((field) => [field.key, field.defaultValue])) as InterfaceTextValues;
    const navigation = await CoreNavigation({ current: "nearby", texts });
    expect(links(navigation).find((link) => link.href === "/nearby")).toEqual({
      href: "/nearby", label: "Рядом", current: "page",
    });
  });
});
