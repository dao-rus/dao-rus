import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ participant: vi.fn(), create: vi.fn(), update: vi.fn(), signals: vi.fn() }));
vi.mock("../../../lib/session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("../../../lib/config", () => ({ appBaseUrl: () => "https://core.daorus.org" }));
vi.mock("../../../lib/signals", async (original) => ({ ...await original<typeof import("../../../lib/signals")>(),
  createSignal: mocks.create, updateSignal: mocks.update, listParticipantSignals: mocks.signals }));
import { POST } from "./route";
import { SignalValidationError } from "../../../lib/signals";
const id = "10000000-0000-4000-8000-000000000001";
function request(fields: Record<string, string>) {
  return new NextRequest("https://core.daorus.org/api/signals", { method: "POST", headers: { Accept: "application/json" },
    body: new URLSearchParams({ type_key: "future_type", label: "Ядро", visibility: "members", ...fields }) });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.participant.mockResolvedValue({ id: "owner" });
  mocks.create.mockResolvedValue({ signal: { id, typeKey: "future_type" } });
  mocks.update.mockResolvedValue({ id, typeKey: "need" });
  mocks.signals.mockResolvedValue([{ id, typeKey: "need" }]);
});
describe("POST /api/signals", () => {
  it("creates a universal signal under the session owner with optional description", async () => {
    const result = await POST(request({ owner_id: "victim" }));
    expect(mocks.create).toHaveBeenCalledWith("owner", { typeKey: "future_type", label: "Ядро", description: null, visibility: "members" });
    expect(await result.json()).toEqual({ location: "/profile#signal-future_type" });
  });
  it("retains existing reward feedback on creation", async () => {
    mocks.create.mockResolvedValue({ signal: { id, typeKey: "need" }, reward: { id: "reward" } });
    expect(await (await POST(request({ type_key: "need" }))).json()).toEqual({ location: "/profile?onboarding_reward=reward#signal-need" });
  });
  it("uses the owned type, not a forged type, when refining", async () => {
    await POST(request({ signal_id: id, type_key: "have", description: "Подробности" }));
    expect(mocks.update).toHaveBeenCalledWith("owner", id, { label: "Ядро", description: "Подробности", visibility: "members" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects guests and foreign editing", async () => {
    mocks.participant.mockResolvedValue(null);
    expect((await POST(request({}))).status).toBe(401);
    mocks.participant.mockResolvedValue({ id: "owner" }); mocks.signals.mockResolvedValue([]);
    expect((await POST(request({ signal_id: id }))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["public", "members", "network_blind"])("rejects dating publication as %s", async (visibility) => {
    expect((await POST(request({ type_key: "dating", visibility }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("returns validation errors without discarding the client form", async () => {
    mocks.create.mockRejectedValue(new SignalValidationError("Unknown or disabled signal type"));
    expect((await POST(request({ type_key: "disabled" }))).status).toBe(400);
  });
});
