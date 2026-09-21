import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  hasPrototypeAdminAccess: vi.fn(),
  saveRewardRule: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/config", () => ({
  appBaseUrl: () => "http://localhost:3000",
  hasPrototypeAdminAccess: mocks.hasPrototypeAdminAccess,
}));
vi.mock("@/lib/tokenization", () => {
  class RewardRuleValidationError extends Error {}
  return {
    parseDarusAmount: (value: FormDataEntryValue | null) => {
      if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
        throw new RewardRuleValidationError();
      }
      return value;
    },
    RewardRuleValidationError,
    saveRewardRule: mocks.saveRewardRule,
  };
});

import { POST } from "./route";

function request(amount: string, active = true) {
  const form = new FormData();
  form.set("amount", amount);
  if (active) form.set("active", "on");
  return new NextRequest("http://localhost:3000/api/admin/rewards", { method: "POST", body: form });
}

describe("admin DARUS tariffs API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("denies non-admin changes before saving", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "ordinary" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(false);
    expect((await POST(request("0.2"))).status).toBe(403);
    expect(mocks.saveRewardRule).not.toHaveBeenCalled();
  });

  it("saves amount and disabled state as the session actor", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "admin" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(true);
    mocks.saveRewardRule.mockResolvedValue(true);
    const response = await POST(request("0.2", false));
    expect(mocks.saveRewardRule).toHaveBeenCalledWith("admin", "0.2", false);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("reward_update=updated");
  });

  it("rejects a malformed amount without saving", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "admin" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(true);
    const response = await POST(request("0.1234567"));
    expect(mocks.saveRewardRule).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("reward_update=invalid");
  });
});
