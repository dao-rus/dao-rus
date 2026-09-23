import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentParticipant: vi.fn(), setReputationSignal: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/config", () => ({ appBaseUrl: () => "http://localhost:3000" }));
vi.mock("@/lib/reputation", () => {
  class ReputationValidationError extends Error {}
  return {
    ReputationValidationError,
    parseReputationAction: (value: unknown) => {
      if (value === "positive" || value === "quality_flag" || value === "revoke") return value;
      throw new ReputationValidationError();
    },
    setReputationSignal: mocks.setReputationSignal,
  };
});
import { POST } from "./route";

const subjectId = "20000000-0000-4000-8000-000000000002";
function request(action: string, subject = subjectId) {
  const form = new FormData();
  form.set("action", action);
  form.set("subject_id", subject);
  return new NextRequest("http://localhost:3000/api/reputation", { method: "POST", body: form });
}

describe("reputation API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a session and derives the actor from it", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    expect((await POST(request("positive"))).headers.get("location")).toBe("http://localhost:3000/");
    expect(mocks.setReputationSignal).not.toHaveBeenCalled();
    mocks.getCurrentParticipant.mockResolvedValue({ id: "actor" });
    mocks.setReputationSignal.mockResolvedValue("created");
    const response = await POST(request("positive"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `http://localhost:3000/profile/${subjectId}?reputation_action=created&reputation_signal=positive`,
    );
    expect(mocks.setReputationSignal).toHaveBeenCalledWith("actor", subjectId, "positive");
  });

  it("only marks an actual positive change for feedback", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "actor" });
    mocks.setReputationSignal.mockResolvedValueOnce("changed").mockResolvedValueOnce("unchanged").mockResolvedValueOnce("created");
    expect((await POST(request("positive"))).headers.get("location")).toContain("reputation_signal=positive");
    expect((await POST(request("positive"))).headers.get("location")).not.toContain("reputation_signal");
    expect((await POST(request("quality_flag"))).headers.get("location")).not.toContain("reputation_signal");
  });

  it("rejects invalid subjects and signal types", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "actor" });
    expect((await POST(request("positive", "../admin"))).status).toBe(400);
    expect((await POST(request("negative"))).headers.get("location")).toContain("reputation_action=invalid");
    expect(mocks.setReputationSignal).not.toHaveBeenCalled();
  });
});
