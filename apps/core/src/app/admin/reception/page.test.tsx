import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { interfaceTextFields, type InterfaceTextValues } from "../../../lib/interface-texts";
const mocks = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.session }));
vi.mock("@/lib/config", () => ({ hasPrototypeAdminAccess: (id: string) => id === "admin" }));
vi.mock("@/components/core-navigation", () => ({ CoreNavigation: () => null }));
vi.mock("@/components/admin-crumbs", () => ({ AdminCrumbs: () => null }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/reception-admin", async () => ({ ...await import("../../../lib/reception-admin"), listReceptionApplications: mocks.list }));
vi.mock("@/lib/interface-texts", () => ({ readInterfaceTexts: async () => ({ values: Object.fromEntries(interfaceTextFields.map(f => [f.key, f.defaultValue])) as InterfaceTextValues }) }));
import Page from "./page";
describe("Reception journal server page", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ id: "admin" }); mocks.list.mockResolvedValue([]); });
  it.each([null, { id: "candidate" }])("does not read applications for an unauthorized viewer: %j", async viewer => {
    mocks.session.mockResolvedValue(viewer); await expect(Page()).rejects.toThrow("redirect:"); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("renders escaped content and manual review controls with version fencing", async () => {
    mocks.list.mockResolvedValue([{ id: "test", telegram_user_id: "84", telegram_name: "<script>unsafe</script>", telegram_username: null,
      city: "<b>City</b>", occupation: "Work", age: null, created_at: new Date(), updated_at: new Date(), application_status: "submitted",
      status: "needs_review", revision: 2, delivered_revision: null, attempted_revision: 1, attempted_at: new Date(), version: 7,
      telegram_chat_id: "-100123", telegram_topic_id: "7", telegram_message_id: null, attempts: 1, retry_at: null, error_code: "telegram_unknown" }]);
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ review: "test" }) }));
    expect(html).toContain("&lt;script&gt;unsafe&lt;/script&gt;"); expect(html).not.toContain("<script>");
    expect(html).toContain('name="version" value="7"'); expect(html).toContain('name="messageId"');
    expect(html).toContain('value="confirm"'); expect(html).toContain('value="retry"'); expect(html).toMatch(/<input(?=[^>]*name="verified")(?=[^>]*required="")[^>]*>/);
    expect(html).toContain('value="invite"'); expect(html).not.toContain("Возраст:");
  });
});
