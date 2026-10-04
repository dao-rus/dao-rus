import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { markNotificationRead } from "@/lib/notifications";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.redirect(new URL("/", appBaseUrl()), 303);

  const form = await request.formData();
  const notificationId = form.get("notification_id");
  if (typeof notificationId !== "string" || !uuidPattern.test(notificationId)) {
    return new NextResponse("Invalid notification", { status: 400 });
  }
  const found = await markNotificationRead(participant.id, notificationId);
  if (!found) return new NextResponse("Notification not found", { status: 404 });
  return NextResponse.redirect(new URL("/notifications", appBaseUrl()), 303);
}
