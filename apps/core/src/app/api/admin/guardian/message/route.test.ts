import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), preview: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/config", () => ({ appBaseUrl: () => "https://core.daorus.org", hasPrototypeAdminAccess: mocks.admin }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.session }));
vi.mock("@/lib/guardian-campaign", () => ({ dispatchGuardianMessage: mocks.send, previewGuardianMessage: mocks.preview }));
import { POST } from "./route";
const key = "11111111-1111-4111-8111-111111111111";
function request(values: Record<string, string> = {}) {
  return new NextRequest("https://core.daorus.org/api/admin/guardian/message", { method: "POST", body: new URLSearchParams({
    text: " Сообщение ", submission_id: key, core: "on", condition: "without_bio", ...values }) });
}
describe("unified message endpoint", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ id: "admin" }); mocks.admin.mockReturnValue(true);
    mocks.preview.mockResolvedValue({ recipientCount: 2 }); mocks.send.mockResolvedValue({ campaign: { id: key } }); });
  it("guards both preview and send before touching data", async () => {
    mocks.session.mockResolvedValueOnce(null); expect((await POST(request({ stage: "preview" }))).status).toBe(303);
    mocks.admin.mockReturnValueOnce(false); expect((await POST(request({ confirm: "send" }))).status).toBe(403);
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it("preview is read-only and never dispatches", async () => {
    const response = await POST(request({ stage: "preview", recipient_ids: "fake", recipient_count: "999" }));
    expect(await response.json()).toEqual({ recipientCount: 2 }); expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.preview).toHaveBeenCalledWith({ text: "Сообщение", submissionId: key, core: true, telegram: false, city: "", interests: [], conditions: ["without_bio"], preset: null, template: null });
  });
  it("requires confirmation and validates channels, text, predicates and city template before sending", async () => {
    const invalid: Record<string, string>[] = [{}, { confirm: "send", core: "" }, { confirm: "send", text: " " }, { confirm: "send", condition: "bad" }, { confirm: "send", template: "town_meeting" }];
    for (const input of invalid) expect((await POST(request(input))).status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("sends only normalized specification through unified dispatch, never browser recipients, CTA or reward", async () => {
    const response = await POST(request({ confirm: "send", preset: "core_login_prompt", core: "", telegram: "on", recipient_ids: "fake", action_url: "https://example.org", reward_sentence: "fake" }));
    expect(mocks.send).toHaveBeenCalledWith("admin", { text: "Сообщение", submissionId: key, core: false, telegram: true, city: "", interests: [], conditions: ["without_bio"], preset: "core_login_prompt", template: null });
    expect(response.status).toBe(303); expect(response.headers.get("location")).toContain(`message=${key}`);
  });
});
