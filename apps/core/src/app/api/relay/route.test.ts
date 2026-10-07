import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  participant: vi.fn(),
  respond: vi.fn(),
  message: vi.fn(),
  consent: vi.fn(),
  cancel: vi.fn(),
  closerOpen: vi.fn(),
  closerNotify: vi.fn(),
}));
vi.mock("@/lib/config", () => ({ appBaseUrl: () => "https://core.daorus.org" }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("@/lib/relay", () => ({
  respondToSignal: mocks.respond,
  sendRelayMessage: mocks.message,
  consentRelayReveal: mocks.consent,
  cancelRelayEncounter: mocks.cancel,
  RelayAccessError: class RelayAccessError extends Error {},
  RelayValidationError: class RelayValidationError extends Error {},
}));
vi.mock("../../../lib/closer", () => ({
  openCloserDialog: mocks.closerOpen,
  CloserUnavailableError: class CloserUnavailableError extends Error {},
}));
vi.mock("../../../lib/closer-notify", () => ({ notifyCloser: mocks.closerNotify }));

import { POST } from "./route";
import { CloserUnavailableError } from "../../../lib/closer";
import { RelayAccessError, RelayValidationError } from "@/lib/relay";

const participantId = "10000000-0000-4000-8000-000000000001";
const encounterId = "50000000-0000-4000-8000-000000000005";

function request(fields: Record<string, string>) {
  return new NextRequest("https://core.daorus.org/api/relay", {
    method: "POST",
    body: new URLSearchParams(fields),
  });
}

describe("Relay form adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.participant.mockResolvedValue({ id: participantId });
  });

  it("creates a private encounter and opens its dialog", async () => {
    mocks.respond.mockResolvedValue({ encounterId, created: false, authorId: null });
    const response = await POST(request({ action: "respond", signal_id: "signal-id" }));
    expect(mocks.respond).toHaveBeenCalledWith(participantId, "signal-id");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://core.daorus.org/relay/" + encounterId);
  });

  it("opens a Closer dialog for the session participant and notifies the other side only when it is new", async () => {
    mocks.closerOpen.mockResolvedValue({ encounterId, notifyParticipantId: "other" });
    const response = await POST(request({ action: "closer_respond", my_signal_id: "mine", signal_id: "theirs" }));
    expect(mocks.closerOpen).toHaveBeenCalledWith(participantId, "mine", "theirs");
    expect(mocks.closerNotify).toHaveBeenCalledWith(["other"], "dialog", "/relay/" + encounterId);
    expect(response.headers.get("location")).toBe("https://core.daorus.org/relay/" + encounterId);
    mocks.closerNotify.mockClear();
    mocks.closerOpen.mockResolvedValue({ encounterId, notifyParticipantId: null });
    await POST(request({ action: "closer_respond", my_signal_id: "mine", signal_id: "theirs" }));
    expect(mocks.closerNotify).not.toHaveBeenCalled();
    mocks.closerOpen.mockRejectedValue(new CloserUnavailableError());
    const denied = await POST(request({ action: "closer_respond", my_signal_id: "mine", signal_id: "theirs" }));
    expect(denied.status).toBe(404);
    expect(denied.headers.get("location")).toBeNull();
  });

  it("leads back to an existing dialog without creating or announcing anything new", async () => {
    mocks.respond.mockResolvedValue({ encounterId, created: false, authorId: null });
    const response = await POST(request({ action: "respond", signal_id: "signal-id" }));
    expect(response.headers.get("location")).toBe("https://core.daorus.org/relay/" + encounterId);
  });

  it("rejects a self-response, closed signal, or foreign encounter without exposing a path", async () => {
    mocks.respond.mockRejectedValue(new RelayAccessError());
    const response = await POST(request({ action: "respond", signal_id: "signal-id" }));
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
    mocks.message.mockRejectedValue(new RelayAccessError());
    const denied = await POST(request({ action: "message", encounter_id: encounterId, body: "Привет" }));
    expect(denied.status).toBe(404);
  });

  it("uses only the session participant for messages and consent", async () => {
    const message = await POST(request({
      action: "message", encounter_id: encounterId, body: "Привет",
      participant_id: "forged-id",
    }));
    expect(mocks.message).toHaveBeenCalledWith(participantId, encounterId, "Привет");
    expect(message.headers.get("location")).toBe("https://core.daorus.org/relay/" + encounterId);
    const consent = await POST(request({ action: "consent", encounter_id: encounterId }));
    expect(mocks.consent).toHaveBeenCalledWith(participantId, encounterId);
    expect(consent.headers.get("location")).toBe("https://core.daorus.org/relay/" + encounterId);
  });

  it("moves cancelled encounters to archive and rejects unauthenticated writes", async () => {
    const response = await POST(request({ action: "cancel", encounter_id: encounterId }));
    expect(mocks.cancel).toHaveBeenCalledWith(participantId, encounterId);
    expect(response.headers.get("location")).toBe("https://core.daorus.org/relay?archive=1");
    mocks.participant.mockResolvedValue(null);
    const denied = await POST(request({ action: "message", encounter_id: encounterId, body: "Привет" }));
    expect(denied.headers.get("location")).toBe("https://core.daorus.org/");
    expect(mocks.message).not.toHaveBeenCalled();
  });

  it("rejects invalid relay input", async () => {
    mocks.message.mockRejectedValue(new RelayValidationError());
    const response = await POST(request({ action: "message", encounter_id: encounterId, body: "" }));
    expect(response.status).toBe(400);
  });
});
