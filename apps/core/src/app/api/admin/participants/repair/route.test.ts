import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  hasPrototypeAdminAccess: vi.fn(),
  repairMembershipBinding: vi.fn(),
  ParticipantRegistryValidationError: class extends Error {},
  ParticipantRegistryNotFoundError: class extends Error {},
  ParticipantRegistryIntegrityError: class extends Error {},
}));

vi.mock("@/lib/config", () => ({
  appBaseUrl: () => "http://localhost:3000",
  hasPrototypeAdminAccess: mocks.hasPrototypeAdminAccess,
}));

vi.mock("@/lib/session", () => ({
  getCurrentParticipant: mocks.getCurrentParticipant,
}));

vi.mock("@/lib/membership-binding-repair", () => ({
  repairMembershipBinding: mocks.repairMembershipBinding,
}));

vi.mock("@/lib/participant-registry", () => ({
  ParticipantRegistryValidationError: mocks.ParticipantRegistryValidationError,
  ParticipantRegistryNotFoundError: mocks.ParticipantRegistryNotFoundError,
  ParticipantRegistryIntegrityError: mocks.ParticipantRegistryIntegrityError,
}));

import { POST } from "./route";

function repairRequest(fields: Record<string, string>) {
  return new Request("http://localhost:3000/api/admin/participants/repair", {
    method: "POST",
    body: new URLSearchParams(fields),
  }) as Parameters<typeof POST>[0];
}

describe("POST /api/admin/participants/repair", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an authenticated ordinary Participant", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "ordinary-participant" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(false);

    const response = await POST(repairRequest({
      telegram_user_id: "1362135676",
    }));

    expect(response.status).toBe(403);
    expect(mocks.repairMembershipBinding).not.toHaveBeenCalled();
  });

  it("takes repair actor only from the authenticated admin session", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "server-session-admin" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(true);
    mocks.repairMembershipBinding.mockResolvedValue({ repaired: true });

    const response = await POST(repairRequest({
      telegram_user_id: "1362135676",
      changed_by_participant_id: "spoofed-client-participant",
    }));

    expect(mocks.repairMembershipBinding).toHaveBeenCalledWith(
      "server-session-admin",
      "1362135676",
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/admin/participants?registry_repair=repaired",
    );
  });
});
