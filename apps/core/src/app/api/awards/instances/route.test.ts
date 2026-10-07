import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ current: vi.fn(), action: vi.fn(), visibility: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.current }));
vi.mock("@/lib/awards", async () => ({ ...await import("../../../../lib/awards"), actOnAwardInstance: mocks.action, setAwardVisibility: mocks.visibility }));
vi.mock("@/lib/award-http", async () => import("../../../../lib/award-http"));
import { POST } from "./route";
const id = "10000000-0000-4000-8000-000000000001";
function request(action: string, extra: Record<string, string> = {}, origin = "http://localhost:3000") { return new NextRequest("http://localhost:3000/api/awards/instances", { method: "POST", headers: { origin }, body: new URLSearchParams({ instanceId: id, action, ...extra }) }); }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("APP_BASE_URL", "http://localhost:3000"); mocks.current.mockResolvedValue({ id }); });
describe("award recipient mutations", () => {
    it("rejects cross-origin before session or mutation", async () => { expect((await POST(request("accept", {}, "https://evil.test"))).status).toBe(403); expect(mocks.current).not.toHaveBeenCalled(); });
    it("requires a session and derives actor only from it", async () => {
        mocks.current.mockResolvedValueOnce(null);
        expect((await POST(request("accept"))).status).toBe(401);
        expect((await POST(request("accept", { actorId: "attacker" }))).status).toBe(303);
        expect(mocks.action).toHaveBeenCalledWith(id, id, "accept");
    });
    it("reject requires explicit confirmation", async () => {
        await POST(request("reject"));
        expect(mocks.action).not.toHaveBeenCalled();
        await POST(request("reject", { confirm: "on" }));
        expect(mocks.action).toHaveBeenCalledWith(id, id, "reject");
    });
    it("two flags are independent and return paths cannot redirect externally", async () => {
        const response = await POST(request("visibility", { showNextToName: "on", returnTo: "https://evil.test" }));
        expect(mocks.visibility).toHaveBeenCalledWith(id, id, { showInPublicList: false, showNextToName: true });
        expect(response.headers.get("location")).toContain(`/award-offers/${id}`);
    });
});
