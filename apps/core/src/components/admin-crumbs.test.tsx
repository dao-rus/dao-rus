import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AdminCrumbs } from "./admin-crumbs";

function nodes(node: ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>; return [{ type: node.type, props }, ...nodes(props.children as ReactNode)];
}
const texts = (el: ReactNode) => nodes(el).filter((n) => n.type === "li").map((n) => nodes(n.props.children as ReactNode)
  .map((c) => c.props.children).find((c) => typeof c === "string"));
const links = (el: ReactNode) => nodes(el).filter((n) => n.props.href).map((n) => n.props.href);

describe("AdminCrumbs", () => {
  it("shows Управление › group › section, only the first being a link on a section page", () => {
    const el = AdminCrumbs({ href: "/admin/guardian/arrivals" });
    expect(texts(el)).toEqual(["Управление", "Люди", "История прибытия"]);
    expect(links(el)).toEqual(["/admin"]);
  });

  it("links the section and the steps before the last one on deeper pages", () => {
    const el = AdminCrumbs({ href: "/admin/awards", trail: [{ label: "Выпуск", href: "/admin/awards/a" }, { label: "Черновик" }] });
    expect(texts(el)).toEqual(["Управление", "Казна", "Награды", "Выпуск", "Черновик"]);
    expect(links(el)).toEqual(["/admin", "/admin/awards", "/admin/awards/a"]);
  });

  it("falls back to the way home for a page that is not in the list", () => {
    expect(texts(AdminCrumbs({ href: "/admin/nowhere" }))).toEqual(["Управление"]);
  });
});
