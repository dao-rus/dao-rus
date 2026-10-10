import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), review: vi.fn(), invite: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.session }));
vi.mock("@/lib/config", () => ({ appBaseUrl: () => "https://core.test", hasPrototypeAdminAccess: (id: string) => id === "admin" }));
vi.mock("@/lib/reception-admin", () => ({ reviewReceptionDelivery: mocks.review, requestReceptionInvitation: mocks.invite, ReceptionAdminError: class extends Error {} }));
import { POST } from "./route";
function request(origin = "https://core.test") {
  return new NextRequest("https://core.test/api/admin/reception", { method: "POST", headers: { origin },
    body: new URLSearchParams({ id: "application", version: "2", action: "retry", verified: "on" }) });
}
describe("Reception administrative actions", () => {
  it.each([null, { id: "candidate" }])("rejects invitation decisions from unauthorized sessions: %j", async session => {
    mocks.session.mockResolvedValue(session);
    const r = new NextRequest("https://core.test/api/admin/reception", { method: "POST", body: new URLSearchParams({ id: "application", action: "invite" }) });
    expect((await POST(r)).status).toBe(403); expect(mocks.invite).not.toHaveBeenCalled();
  });
  it("records an invitation decision without a Telegram call in HTTP", async () => {
    const r = new NextRequest("https://core.test/api/admin/reception", { method: "POST", body: new URLSearchParams({ id: "application", action: "invite" }) });
    expect((await POST(r)).status).toBe(303); expect(mocks.invite).toHaveBeenCalledWith("admin", "application"); expect(mocks.review).not.toHaveBeenCalled();
  });
  beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ id: "admin" }); });
  it.each([null, { id: "candidate" }])("rejects unauthorized sessions before recovery: %j", async session => {
    mocks.session.mockResolvedValue(session); expect((await POST(request())).status).toBe(403); expect(mocks.review).not.toHaveBeenCalled();
  });
  it("rejects cross-origin changes", async () => { expect((await POST(request("https://other.test"))).status).toBe(403); expect(mocks.review).not.toHaveBeenCalled(); });
  it("passes authenticated actor and attestation to the server service", async () => {
    expect((await POST(request())).status).toBe(303);
    expect(mocks.review).toHaveBeenCalledWith("admin", { id: "application", version: 2, action: "retry", verified: true, messageId: "" });
  });
});
