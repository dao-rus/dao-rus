import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  hasPrototypeAdminAccess: vi.fn(),
  addVerificationRoot: vi.fn(),
  VerificationNotFoundError: class extends Error {},
  VerificationValidationError: class extends Error {},
}));

vi.mock("@/lib/config", () => ({
  appBaseUrl: () => "http://localhost:3000",
  hasPrototypeAdminAccess: mocks.hasPrototypeAdminAccess,
}));
vi.mock("@/lib/session", () => ({
  getCurrentParticipant: mocks.getCurrentParticipant,
}));
vi.mock("@/lib/verification", () => ({
  addVerificationRoot: mocks.addVerificationRoot,
  VerificationNotFoundError: mocks.VerificationNotFoundError,
  VerificationValidationError: mocks.VerificationValidationError,
}));

import { POST } from "./route";

function request(subjectId: string) {
  return new Request("http://localhost:3000/api/admin/verification/roots", {
    method: "POST",
    body: new URLSearchParams({ subject_id: subjectId }),
  }) as Parameters<typeof POST>[0];
}

describe("POST /api/admin/verification/roots", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not let an ordinary Participant add roots", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "ordinary-subject" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(false);
    const response = await POST(request("target-subject"));
    expect(response.status).toBe(403);
    expect(mocks.addVerificationRoot).not.toHaveBeenCalled();
  });

  it("uses the authenticated admin as root audit actor", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "admin-subject" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(true);
    mocks.addVerificationRoot.mockResolvedValue({ changed: true });
    const response = await POST(request("target-subject"));

    expect(mocks.addVerificationRoot).toHaveBeenCalledWith(
      "admin-subject",
      "target-subject",
    );
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/profile/target-subject?verification_root=added",
    );
  });
});
