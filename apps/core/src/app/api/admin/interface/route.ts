import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl, hasPrototypeAdminAccess } from "@/lib/config";
import {
  InterfaceTextValidationError,
  parseInterfaceTextForm,
  saveInterfaceTexts,
} from "@/lib/interface-texts";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

function interfaceRedirect(status: string) {
  const url = new URL("/admin/interface", appBaseUrl());
  url.searchParams.set("interface_update", status);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  if (!hasPrototypeAdminAccess(participant.id)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  try {
    const desired = parseInterfaceTextForm(await request.formData());
    const changedKeys = await saveInterfaceTexts(participant.id, desired);
    return interfaceRedirect(changedKeys.length ? "updated" : "unchanged");
  } catch (error) {
    if (error instanceof InterfaceTextValidationError) return interfaceRedirect("invalid");
    throw error;
  }
}
