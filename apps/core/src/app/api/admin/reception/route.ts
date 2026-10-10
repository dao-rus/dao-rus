import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl, hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { ReceptionAdminError, reviewReceptionDelivery } from "@/lib/reception-admin";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(appBaseUrl()).origin) return new NextResponse("Forbidden", { status: 403 });
  const participant = await getCurrentParticipant();
  if (!participant || !hasPrototypeAdminAccess(participant.id)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  try {
    await reviewReceptionDelivery(participant.id, {
      id, version: Number(form.get("version")), action: String(form.get("action")) as "inspect" | "confirm" | "retry",
      verified: form.get("verified") === "on", messageId: String(form.get("messageId") ?? ""),
    });
    const url = new URL("/admin/reception", appBaseUrl());
    url.searchParams.set("review", id);
    return NextResponse.redirect(url, 303);
  } catch (error) {
    if (error instanceof ReceptionAdminError) return new NextResponse(error.message, { status: error.message === "forbidden" ? 403 : 409 });
    throw error;
  }
}
