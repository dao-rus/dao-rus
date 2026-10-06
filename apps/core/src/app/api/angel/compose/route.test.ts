import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ participant: vi.fn(), types: vi.fn(), texts: vi.fn(), provider: vi.fn(), allow: vi.fn(), risk: vi.fn(), ProviderError: class ProviderError extends Error {} }));
vi.mock("../../../../lib/session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("../../../../lib/signals", () => ({
  listSignalTypes: mocks.types,
  normalizeSignalTypeKey: (value: unknown) => { if (typeof value !== "string") throw new Error("invalid"); return value; },
  normalizeSignalLabel: (value: unknown) => { if (typeof value !== "string" || value.length > 120) throw new Error("invalid"); return value; },
  normalizeSignalDescription: (value: unknown) => value === null ? null : typeof value === "string" ? value : (() => { throw new Error("invalid"); })(),
}));
vi.mock("../../../../lib/interface-texts", () => ({ readInterfaceTexts: mocks.texts }));
vi.mock("../../../../lib/angel-openai", () => ({ getAngelProvider: mocks.provider, AngelProviderError: mocks.ProviderError }));
vi.mock("../../../../lib/angel-audit", () => ({ allowAngelRequest: mocks.allow, recordAngelRisk: mocks.risk }));
import { POST } from "./route";
function request(text: unknown) { return new Request("http://core.test/api/angel/compose", { method: "POST", body: JSON.stringify({ text }), headers: { "Content-Type": "application/json" } }) as never; }
beforeEach(() => {
  vi.clearAllMocks(); mocks.participant.mockResolvedValue({ id: "owner" }); mocks.types.mockResolvedValue([{ key: "skill", displayName: "Умею", enabled: true }]);
  mocks.texts.mockResolvedValue({ values: { "signal.skill.name": "Умею", "signal.skill.description": "Навык", "signal.skill.example": "ремонт", "signal.label_placeholder": "" } });
  mocks.allow.mockResolvedValue(true); mocks.provider.mockReturnValue({ compose: vi.fn().mockResolvedValue({ operation: "compose_signal", typeKey: "skill", label: "ремонт", description: null }) });
});
describe("POST /api/angel/compose", () => {
  it("returns a proposal only and never imports a Signal write path", async () => {
    const response = await POST(request("Умею чинить радиоприёмники"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ proposal: { operation: "compose_signal", typeKey: "skill", label: "ремонт", description: null } });
    expect(mocks.allow).toHaveBeenCalledWith("owner", "compose_signal");
  });
  it("rejects SQL-like input before OpenAI and records a minimal risk event", async () => {
    const response = await POST(request("SELECT * FROM profile_signals"));
    expect(response.status).toBe(400); expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.risk).toHaveBeenCalledWith("owner", "suspicious_prompt", "compose_signal");
  });
  it("fails closed for invalid output and rate limits without creating a Signal", async () => {
    mocks.provider.mockReturnValue({ compose: vi.fn().mockResolvedValue({ operation: "compose_signal", typeKey: "disabled", label: "x", description: null }) });
    expect((await POST(request("нужна помощь"))).status).toBe(400);
    expect(mocks.risk).toHaveBeenCalledWith("owner", "invalid_model_output", "compose_signal");
    mocks.allow.mockResolvedValue(false);
    expect((await POST(request("нужна помощь"))).status).toBe(429);
  });
  it("returns a neutral failure when the provider refuses or times out", async () => {
    mocks.provider.mockReturnValue({ compose: vi.fn().mockRejectedValue(new mocks.ProviderError()) });
    expect((await POST(request("нужна помощь"))).status).toBe(400);
    expect(mocks.risk).toHaveBeenCalledWith("owner", "provider_failure", "compose_signal");
  });
});
