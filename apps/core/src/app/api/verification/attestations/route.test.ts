import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  VerificationEligibilityError: class extends Error {},
  VerificationNotFoundError: class extends Error {},
  VerificationValidationError: class extends Error {},
}));

vi.mock("@/lib/config", () => ({ appBaseUrl: () => "http://localhost:3000" }));
vi.mock("@/lib/session", () => ({
  getCurrentParticipant: mocks.getCurrentParticipant,
}));
vi.mock("@/lib/verification", () => ({
  createVerificationAttestation: mocks.create,
  revokeVerificationAttestation: mocks.revoke,
  VerificationEligibilityError: mocks.VerificationEligibilityError,
  VerificationNotFoundError: mocks.VerificationNotFoundError,
  VerificationValidationError: mocks.VerificationValidationError,
}));

import { POST } from "./route";

function request(fields: Record<string, string>) {
  return new Request("http://localhost:3000/api/verification/attestations", {
    method: "POST",
    body: new URLSearchParams(fields),
  }) as Parameters<typeof POST>[0];
}

describe("POST /api/verification/attestations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires an authenticated Core Subject", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    const response = await POST(request({ action: "create", subject_id: "target" }));
    expect(response.status).toBe(303);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("takes the verifier only from the server session", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "session-subject" });
    mocks.create.mockResolvedValue({ changed: true, attestationId: "attestation" });
    const response = await POST(request({
      action: "create",
      subject_id: "target-subject",
      verifier_subject_id: "spoofed-subject",
    }));

    expect(mocks.create).toHaveBeenCalledWith("session-subject", "target-subject");
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profile/target-subject?verification_action=created",
    );
  });

  it("redirects with a reward ID only when the ledger inserted a new entry", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "session-subject" });
    mocks.create.mockResolvedValue({ changed: true, attestationId: "attestation", rewardEntryId: "reward-entry" });
    const rewarded = await POST(request({ action: "create", subject_id: "target-subject" }));
    expect(rewarded.headers.get("location")).toBe(
      "http://localhost:3000/profile/target-subject?verification_action=created&verification_reward=reward-entry",
    );

    mocks.create.mockResolvedValue({ changed: true, attestationId: "another-attestation" });
    const withoutReward = await POST(request({ action: "create", subject_id: "target-subject" }));
    expect(withoutReward.headers.get("location")).toBe(
      "http://localhost:3000/profile/target-subject?verification_action=created",
    );

    mocks.revoke.mockResolvedValue({ changed: true, attestationId: "attestation" });
    const revoked = await POST(request({ action: "revoke", subject_id: "target-subject" }));
    expect(revoked.headers.get("location")).toBe(
      "http://localhost:3000/profile/target-subject?verification_action=revoked",
    );
  });
});
