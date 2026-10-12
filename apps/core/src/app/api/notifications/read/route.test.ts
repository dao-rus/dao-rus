import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentParticipant: vi.fn(), markNotificationRead: vi.fn(), openNotification: vi.fn(), markAllNotificationsRead: vi.fn() }));
vi.mock("@/lib/config", () => ({ appBaseUrl: () => "https://core.daorus.org" }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/notifications", async () => ({ ...await import("../../../../lib/notifications"),
  markNotificationRead: mocks.markNotificationRead, openNotification: mocks.openNotification, markAllNotificationsRead: mocks.markAllNotificationsRead }));

import { POST } from "./route";
import * as route from "./route";
import { NotificationValidationError } from "../../../../lib/notifications";

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
  it("opens only the stored URL, ignoring a user-supplied redirect", async () => {
    mocks.openNotification.mockResolvedValue({ actionUrl: "/relay/123" });
    const req = new NextRequest("https://core.daorus.org/api/notifications/read", { method: "POST",
      body: new URLSearchParams({ notification_id: id, action: "open", return_to: "https://evil.example" }) });
    const response = await POST(req);
    expect(mocks.openNotification).toHaveBeenCalledWith("recipient", id);
    expect(response.headers.get("location")).toBe("https://core.daorus.org/relay/123");
    expect(route).not.toHaveProperty("GET");
  });
  it("marks all for the recipient and returns only to a fixed filter URL", async () => {
    const response = await POST(new NextRequest("https://core.daorus.org/api/notifications/read", { method: "POST",
      body: new URLSearchParams({ action: "mark_all", view: "unread" }) }));
    expect(mocks.markAllNotificationsRead).toHaveBeenCalledWith("recipient");
    expect(response.headers.get("location")).toBe("https://core.daorus.org/notifications?view=unread");
  });
  it("denies foreign/unsafe open actions and cross-origin writes", async () => {
    const make = () => new NextRequest("https://core.daorus.org/api/notifications/read", { method: "POST",
      body: new URLSearchParams({ notification_id: id, action: "open" }) });
    mocks.openNotification.mockResolvedValue(null);
    expect((await POST(make())).status).toBe(404);
    mocks.openNotification.mockRejectedValue(new NotificationValidationError("Unsafe URL"));
    expect((await POST(make())).status).toBe(400);
    const cross = make(); cross.headers.set("origin", "https://evil.example");
    expect((await POST(cross)).status).toBe(403);
    expect(mocks.openNotification).toHaveBeenCalledTimes(2);
  });
});
