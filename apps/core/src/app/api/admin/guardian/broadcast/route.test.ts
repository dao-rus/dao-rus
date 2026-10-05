import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), launch: vi.fn() }));
vi.mock("@/lib/config", () => ({ appBaseUrl: () => "https://core.daorus.org", hasPrototypeAdminAccess: mocks.admin }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.session }));
vi.mock("@/lib/guardian-campaign", () => ({ launchTechnicalBroadcast: mocks.launch }));
import { POST } from "./route";
const key = "11111111-1111-4111-8111-111111111111";
function request(values: Record<string, string> = {}) {
  return new NextRequest("https://core.daorus.org/api/admin/guardian/broadcast", { method: "POST",
    body: new URLSearchParams({ text: " Сообщение ", core: "on", city: "city-key", interest: "art", submission_id: key, ...values }) });
}
describe("POST technical broadcast", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ id: "admin" }); mocks.admin.mockReturnValue(true);
    mocks.launch.mockResolvedValue({ campaign: { id: key } }); });
  it("requires the existing admin session before any launch", async () => {
    mocks.session.mockResolvedValueOnce(null); expect((await POST(request())).status).toBe(303);
    mocks.admin.mockReturnValueOnce(false); expect((await POST(request())).status).toBe(403);
    expect(mocks.launch).not.toHaveBeenCalled();
  });
  it("validates text, channels and idempotency key before launch", async () => {
    const invalid: Record<string, string>[] = [{ text: " " }, { core: "" }, { submission_id: "bad" }];
    for (const input of invalid) expect((await POST(request(input))).status).toBe(400);
    expect(mocks.launch).not.toHaveBeenCalled();
  });
  it("passes filters and channels only, ignoring recipient ids, counts and CTA", async () => {
    const response = await POST(request({ core: "", telegram: "on", recipient_ids: "other", recipient_count: "999", action_url: "https://example.org" }));
    expect(mocks.launch).toHaveBeenCalledWith("admin", { text: "Сообщение", core: false, telegram: true, city: "city-key", interests: ["art"], submissionId: key });
    expect(response.status).toBe(303); expect(response.headers.get("location")).toContain(`broadcast=${key}`);
    expect(response.headers.get("location")).toContain("interest=art");
  });
});
