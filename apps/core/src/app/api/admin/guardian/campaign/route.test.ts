import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentParticipant: vi.fn(), hasPrototypeAdminAccess: vi.fn(), launch: vi.fn() }));
vi.mock("@/lib/config", () => ({ appBaseUrl: () => "https://core.daorus.org", hasPrototypeAdminAccess: mocks.hasPrototypeAdminAccess }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/guardian-campaign", () => ({ launchProfileInterestsCampaign: mocks.launch }));

import { POST } from "./route";

function request(values: Record<string, string> = {}) {
  return new NextRequest("https://core.daorus.org/api/admin/guardian/campaign", {
    method: "POST",
    body: new URLSearchParams({ text: "Отредактированный текст", action_label: "Интересы",
      action_url: "/profile#profile-interests", ...values }),
  });
}

describe("POST Guardian campaign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentParticipant.mockResolvedValue({ id: "admin" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(true);
    mocks.launch.mockResolvedValue({ launched: true });
  });

  it("enforces existing session and admin guard", async () => {
    mocks.getCurrentParticipant.mockResolvedValueOnce(null);
    expect((await POST(request({ confirm: "launch" }))).status).toBe(303);
    mocks.hasPrototypeAdminAccess.mockReturnValueOnce(false);
    expect((await POST(request({ confirm: "launch" }))).status).toBe(403);
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation and validates before any write", async () => {
    expect((await POST(request())).status).toBe(400);
    expect((await POST(request({ confirm: "launch", action_url: "javascript:alert(1)" }))).status).toBe(400);
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("launches from edited fields and redirects to the saved result", async () => {
    const response = await POST(request({ confirm: "launch" }));
    expect(mocks.launch).toHaveBeenCalledWith("admin", {
      text: "Отредактированный текст", actionLabel: "Интересы", actionUrl: "/profile#profile-interests",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://core.daorus.org/admin/guardian?campaign=launched");
  });
});
