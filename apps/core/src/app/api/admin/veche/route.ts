import { parseSignatureSettings, saveSignatureSettings } from "@/lib/veche-signatures";
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
    const signatures = parseSignatureSettings({ fractionDao: form.get("fractionDao"), fractionCity: form.get("fractionCity"), days: form.get("signatureDays"), cooldownDays: form.get("signatureCooldown") });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await saveVecheSettings(client, settings);
      await saveSignatureSettings(client, signatures);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    url.searchParams.set("outcome", "saved");
  } catch (error) {
    if (!(error instanceof VecheError)) throw error;
    url.searchParams.set("outcome", "invalid");
  }
  return NextResponse.redirect(url, 303);
}
