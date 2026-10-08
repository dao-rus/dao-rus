import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), award: vi.fn() }));
vi.mock("@/lib/config", () => ({ hasPrototypeAdminAccess: mocks.admin }));
vi.mock("@/lib/award-access", () => ({ hasAwardCapability: mocks.award }));

import { canOpenAdminSection, hasAnyAdminSection, visibleAdminGroups } from "./admin-access";
import { adminGroups, findAdminSection } from "./admin-sections";

// Every static page under app/admin must be reachable from the Управление page.
function adminPageRoutes(dir: string, route = "/admin"): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name.startsWith("[") ? [] : adminPageRoutes(path, `${route}/${name}`);
    return name === "page.tsx" ? [route] : [];
  });
}

describe("admin sections", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockReturnValue(false); mocks.award.mockReturnValue(false); });

  it("lists every static admin page exactly once, and nothing that does not exist", () => {
    const listed = adminGroups.flatMap((group) => group.sections.map((section) => section.href));
    expect(new Set(listed).size).toBe(listed.length);
    const pages = adminPageRoutes(join(__dirname, "../app/admin")).filter((route) => route !== "/admin");
    expect([...listed].sort()).toEqual([...pages].sort());
  });

  it("keeps the agreed groups", () => {
    expect(adminGroups.map((group) => group.title)).toEqual(["Люди", "Хранитель", "Казна", "Слова и справочники"]);
  });

  it("shows an administrator everything except what needs the awards authority", () => {
    mocks.admin.mockReturnValue(true);
    const hrefs = visibleAdminGroups("a").flatMap((group) => group.sections.map((section) => section.href));
    expect(hrefs).not.toContain("/admin/awards");
    expect(hrefs).toContain("/admin/guardian/arrivals");
    expect(hasAnyAdminSection("a")).toBe(true);
  });

  it("gives the awards authority its own section and drops groups left empty", () => {
    mocks.award.mockReturnValue(true);
    const groups = visibleAdminGroups("founder");
    expect(groups.map((group) => group.title)).toEqual(["Казна"]);
    expect(groups[0].sections.map((section) => section.href)).toEqual(["/admin/awards"]);
  });

  it("shows nobody else anything", () => {
    expect(visibleAdminGroups("x")).toEqual([]);
    expect(hasAnyAdminSection("x")).toBe(false);
    expect(canOpenAdminSection("x", adminGroups[0].sections[0])).toBe(false);
  });

  it("finds the group of a section for the breadcrumb", () => {
    expect(findAdminSection("/admin/guardian/arrivals")?.group.title).toBe("Люди");
    expect(findAdminSection("/admin/nowhere")).toBeNull();
  });
});
