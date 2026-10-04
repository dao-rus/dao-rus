import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentParticipant: vi.fn(), markNotificationRead: vi.fn() }));
vi.mock("@/lib/config", () => ({ appBaseUrl: () => "https://core.daorus.org" }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/notifications", () => ({ markNotificationRead: mocks.markNotificationRead }));

import { POST } from "./route";

const id = "123e4567-e89b-42d3-a456-426614174000";
function request(notificationId = id) {
  return new NextRequest("https://core.daorus.org/api/notifications/read", {
    method: "POST", body: new URLSearchParams({ notification_id: notificationId }),
  });
}

describe("POST /api/notifications/read", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getCurrentParticipant.mockResolvedValue({ id: "recipient" }); });

  it("redirects unauthenticated users without writing", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://core.daorus.org/");
    expect(mocks.markNotificationRead).not.toHaveBeenCalled();
  });

  it("marks only the authenticated participant's notification", async () => {
    mocks.markNotificationRead.mockResolvedValue(true);
    const response = await POST(request());
    expect(mocks.markNotificationRead).toHaveBeenCalledWith("recipient", id);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://core.daorus.org/notifications");
  });

  it("returns 404 for a foreign notification and 400 for an invalid id", async () => {
    mocks.markNotificationRead.mockResolvedValue(false);
    expect((await POST(request())).status).toBe(404);
    expect((await POST(request("invalid"))).status).toBe(400);
    expect(mocks.markNotificationRead).toHaveBeenCalledTimes(1);
  });
});
