import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentParticipant: vi.fn(), setCommunicationSignal: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/config", () => ({ appBaseUrl: () => "http://localhost:3000" }));
vi.mock("@/lib/communication-reputation", () => {
  return { setCommunicationSignal: mocks.setCommunicationSignal };
});
vi.mock("@/lib/reputation", () => {
  class ReputationValidationError extends Error {}
  return { ReputationValidationError };
});

import { POST } from "./route";

const subjectId = "20000000-0000-4000-8000-000000000002";
function request(action: string, subject = subjectId) {
  const form = new FormData();
  form.set("action", action);
  form.set("subject_id", subject);
  return new NextRequest("http://localhost:3000/api/communication-reputation", { method: "POST", body: form });
}

describe("communication reputation API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a Core session and uses its participant as the evaluator", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    expect((await POST(request("positive"))).headers.get("location")).toBe("http://localhost:3000/");
    expect(mocks.setCommunicationSignal).not.toHaveBeenCalled();

    mocks.getCurrentParticipant.mockResolvedValue({ id: "10000000-0000-4000-8000-000000000001" });
    mocks.setCommunicationSignal.mockResolvedValue("created");
    const response = await POST(request("positive"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost:3000/profile/${subjectId}?communication_action=created`,
    );
    expect(mocks.setCommunicationSignal).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001", subjectId, "positive",
    );
  });

  it("accepts positive, negative and revoke actions, and rejects invalid values or subjects", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "10000000-0000-4000-8000-000000000001" });
    mocks.setCommunicationSignal.mockResolvedValueOnce("created").mockResolvedValueOnce("changed").mockResolvedValueOnce("revoked");
    for (const action of ["positive", "negative", "revoke"]) {
      expect((await POST(request(action))).headers.get("location")).toContain("communication_action=");
    }
    expect(mocks.setCommunicationSignal.mock.calls.map((call) => call[2])).toEqual(["positive", "negative", "revoke"]);
    expect((await POST(request("quality_flag"))).headers.get("location")).toContain("communication_action=invalid");
    expect((await POST(request("positive", "../../admin"))).status).toBe(400);
    expect(mocks.setCommunicationSignal).toHaveBeenCalledTimes(3);
  });

  it("maps self-rating validation to a safe result", async () => {
    const actorId = "10000000-0000-4000-8000-000000000001";
    mocks.getCurrentParticipant.mockResolvedValue({ id: actorId });
    mocks.setCommunicationSignal.mockRejectedValue(new (await import("@/lib/reputation")).ReputationValidationError("Cannot rate yourself"));
    expect((await POST(request("negative", actorId))).headers.get("location"))
      .toContain("communication_action=self");
  });
});
