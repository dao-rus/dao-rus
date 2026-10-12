import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ current: vi.fn(), action: vi.fn(), visibility: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.current }));
vi.mock("@/lib/awards", async () => ({ ...await import("../../../../lib/awards"), actOnAwardInstance: mocks.action, setAwardVisibility: mocks.visibility }));
vi.mock("@/lib/award-http", async () => import("../../../../lib/award-http"));
import { POST } from "./route";
import { AwardAccessError, AwardNotFoundError, AwardTransitionError, AwardValidationError } from "../../../../lib/awards";
const id = "10000000-0000-4000-8000-000000000001";
function request(action: string, extra: Record<string, string> = {}, origin = "http://localhost:3000") { return new NextRequest("http://localhost:3000/api/awards/instances", { method: "POST", headers: { origin }, body: new URLSearchParams({ instanceId: id, action, ...extra }) }); }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("APP_BASE_URL", "http://localhost:3000"); mocks.current.mockResolvedValue({ id }); });
describe("award recipient mutations", () => {
    function jsonRequest(action: string, extra: Record<string, string> = {}, origin = "http://localhost:3000") {
        const input = request(action, extra, origin); input.headers.set("accept", "application/json"); return input;
    }
    it("returns the authoritative instance for fetch callers without changing browser form redirects", async () => {
        const result = { instance: { id, status: "accepted", acceptedAt: new Date("2026-10-12T12:00:00Z") }, changed: true };
        mocks.action.mockResolvedValueOnce(result);
        const response = await POST(jsonRequest("accept", { actorId: "attacker" }));
        expect(response.status).toBe(200); expect(response.headers.get("location")).toBeNull();
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({ ...result, instance: { ...result.instance, acceptedAt: result.instance.acceptedAt.toISOString() } });
        expect(mocks.action).toHaveBeenCalledWith(id, id, "accept");
        mocks.visibility.mockResolvedValueOnce({ instance: { id, status: "accepted", showInPublicList: true, showNextToName: false }, changed: true });
        const settings = await POST(jsonRequest("visibility", { showInPublicList: "on" }));
        expect((await settings.json()).instance).toMatchObject({ showInPublicList: true, showNextToName: false });
    });
    it.each([[new AwardAccessError("PRIVATE"),403,"forbidden"], [new AwardNotFoundError("PRIVATE"),404,"not_found"],
      [new AwardTransitionError("PRIVATE"),409,"state"], [new AwardValidationError("PRIVATE"),400,"invalid"]])("returns safe JSON errors for %s", async (error,status,code) => {
        mocks.action.mockRejectedValueOnce(error);
        const response = await POST(jsonRequest("accept"));
        expect(response.status).toBe(status); expect(await response.json()).toEqual({ error: code });
    });
    it("retains session, origin and irreversible rejection checks for JSON callers", async () => {
        const origin = await POST(jsonRequest("accept", {}, "https://evil.test"));
        expect(origin.status).toBe(403); expect(await origin.json()).toEqual({ error: "forbidden" });
        expect(mocks.current).not.toHaveBeenCalled();
        mocks.current.mockResolvedValueOnce(null);
        const guest = await POST(jsonRequest("accept")); expect(guest.status).toBe(401); expect(await guest.json()).toEqual({ error: "unauthorized" });
        const rejected = await POST(jsonRequest("reject")); expect(rejected.status).toBe(400); expect(mocks.action).not.toHaveBeenCalled();
    });
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
