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
    body: new URLSearchParams({ text: "Отредактированный текст", ...values }),
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
    expect((await POST(request({ confirm: "launch", text: " " }))).status).toBe(400);
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it("launches from edited text and ignores user-supplied CTA or URL", async () => {
    const response = await POST(request({ confirm: "launch", action_label: "Подмена", action_url: "https://example.org" }));
    expect(mocks.launch).toHaveBeenCalledWith("admin", { text: "Отредактированный текст" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://core.daorus.org/admin/guardian?campaign=launched");
  });
});
