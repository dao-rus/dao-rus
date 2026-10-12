import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { markNotificationRead, markAllNotificationsRead, openNotification, NotificationValidationError } from "@/lib/notifications";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(appBaseUrl()).origin) return new NextResponse("Forbidden", { status: 403 });
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.redirect(new URL("/", appBaseUrl()), 303);

  const form = await request.formData();
  const action = form.get("action") ?? "mark";
  const inboxUrl = new URL(form.get("view") === "unread" ? "/notifications?view=unread" : "/notifications", appBaseUrl());
  if (action === "mark_all") {
    await markAllNotificationsRead(participant.id);
    return NextResponse.redirect(inboxUrl, 303);
  }
  if (action !== "mark" && action !== "open") return new NextResponse("Invalid action", { status: 400 });
  const notificationId = form.get("notification_id");
  if (typeof notificationId !== "string" || !uuidPattern.test(notificationId)) {
    return new NextResponse("Invalid notification", { status: 400 });
  }
  if (action === "open") {
    try {
      const found = await openNotification(participant.id, notificationId);
      if (!found) return new NextResponse("Notification not found", { status: 404 });
      return NextResponse.redirect(found.actionUrl ? new URL(found.actionUrl, appBaseUrl()) : inboxUrl, 303);
    } catch (error) {
      if (error instanceof NotificationValidationError) return new NextResponse("Invalid notification action", { status: 400 });
      throw error;
    }
  }
  const found = await markNotificationRead(participant.id, notificationId);
  if (!found) return new NextResponse("Notification not found", { status: 404 });
  return NextResponse.redirect(inboxUrl, 303);
}
