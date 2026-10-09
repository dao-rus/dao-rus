import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl, hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { parseVecheSettings, saveVecheSettings, VecheError } from "@/lib/veche-polls";
import { pool } from "@/lib/db";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(appBaseUrl()).origin) return new NextResponse("Forbidden", { status: 403 });
  const participant = await getCurrentParticipant();
  if (!participant) return new NextResponse("Unauthorized", { status: 401 });
  if (!hasPrototypeAdminAccess(participant.id)) return new NextResponse("Forbidden", { status: 403 });
  const url = new URL("/admin/veche", appBaseUrl());
  try {
    const form = await request.formData();
    const settings = parseVecheSettings({ inactivityDays: form.get("inactivityDays"), quorumDao: form.get("quorumDao"), quorumCity: form.get("quorumCity") });
    await saveVecheSettings(pool, settings);
    url.searchParams.set("outcome", "saved");
  } catch (error) {
    if (!(error instanceof VecheError)) throw error;
    url.searchParams.set("outcome", "invalid");
  }
  return NextResponse.redirect(url, 303);
}
