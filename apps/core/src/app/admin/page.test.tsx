import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), award: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.session }));
vi.mock("@/lib/config", () => ({ hasPrototypeAdminAccess: mocks.admin }));
vi.mock("@/lib/award-access", () => ({ hasAwardCapability: mocks.award }));
vi.mock("../../components/core-navigation", () => ({ CoreNavigation: () => null }));
import Page from "./page";

function nodes(node: ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>; return [{ type: node.type, props }, ...nodes(props.children as ReactNode)];
}
const hrefs = (page: ReactNode) => nodes(page).filter((n) => n.props.href).map((n) => n.props.href);

describe("/admin", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.session.mockResolvedValue({ id: "p" }); mocks.admin.mockReturnValue(false); mocks.award.mockReturnValue(false);
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });

  it("sends visitors and people without any authority away", async () => {
    mocks.session.mockResolvedValueOnce(null); await expect(Page()).rejects.toThrow("redirect:/");
    await expect(Page()).rejects.toThrow("redirect:/profile");
  });

  it("shows an administrator the four groups without awards", async () => {
    mocks.admin.mockReturnValue(true);
    const page = await Page();
    const headings = nodes(page).filter((n) => n.type === "h2").map((n) => n.props.children);
    expect(headings).toEqual(["Люди", "Хранитель", "Казна", "Слова и справочники"]);
    expect(hrefs(page)).toContain("/admin/guardian/forum");
    expect(hrefs(page)).not.toContain("/admin/awards");
  });

  it("opens awards, and only awards, to the awards authority", async () => {
    mocks.award.mockReturnValue(true);
    const page = await Page();
    expect(hrefs(page).filter((href) => String(href).startsWith("/admin"))).toEqual(["/admin/awards"]);
  });
});
