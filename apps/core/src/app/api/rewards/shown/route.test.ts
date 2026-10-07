import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentParticipant: vi.fn(), markRewardShown: vi.fn() }));
vi.mock("../../../../lib/config", () => ({ appBaseUrl: () => "https://core.daorus.org" }));
vi.mock("../../../../lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("../../../../lib/reward-announcements", () => ({ markRewardShown: mocks.markRewardShown }));

import { POST } from "./route";

function request(origin?: string) {
  return new NextRequest("https://core.daorus.org/api/rewards/shown", {
    method: "POST", body: new URLSearchParams({ entry_id: "entry" }), headers: origin ? { origin } : undefined,
  });
}

describe("POST /api/rewards/shown", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getCurrentParticipant.mockResolvedValue({ id: "owner" }); });

  it("marks the reward for the signed-in participant only", async () => {
    expect((await POST(request("https://core.daorus.org"))).status).toBe(204);
    expect(mocks.markRewardShown).toHaveBeenCalledWith("owner", "entry");
  });

  it("refuses guests and foreign origins without writing", async () => {
    expect((await POST(request("https://evil.example"))).status).toBe(403);
    mocks.getCurrentParticipant.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.markRewardShown).not.toHaveBeenCalled();
  });
});
