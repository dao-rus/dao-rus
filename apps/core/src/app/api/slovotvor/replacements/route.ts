import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import {
  publishSlovotvorReplacementRequest,
  SlovotvorReplacementError,
} from "@/lib/slovotvor-replacements";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const participant = await getCurrentParticipant();
  if (!participant) {
    const login = new URL("/api/auth/telegram/start", appBaseUrl());
    login.searchParams.set("next", "/slovotvor");
    return NextResponse.redirect(login, 303);
  }

  try {
    const result = await publishSlovotvorReplacementRequest(participant.id, form.get("source"));
    const target = new URL("/slovotvor", appBaseUrl());
    if (result.duplicate) {
      target.searchParams.set("replacement_error", "duplicate");
      target.searchParams.set("replacement_id", result.request.id);
    }
    return NextResponse.redirect(target, 303);
  } catch (error) {
    const target = new URL("/slovotvor", appBaseUrl());
    target.searchParams.set("replacement_error", error instanceof SlovotvorReplacementError ? error.code : "failed");
    return NextResponse.redirect(target, 303);
  }
}
