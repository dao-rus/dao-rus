import { NextRequest, NextResponse } from "next/server";
import { getCurrentParticipant } from "@/lib/session";
import { appBaseUrl } from "@/lib/config";
import { publishSlovotvorWord, SlovotvorPublicationError } from "@/lib/slovotvor-publication";

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
    const result = await publishSlovotvorWord(
      participant.id,
      form.get("word"),
      form.get("source"),
      form.get("explanation"),
    );
    if (result.duplicate) {
      const duplicate = new URL("/slovotvor", appBaseUrl());
      duplicate.searchParams.set("error", "duplicate");
      duplicate.searchParams.set("slug", result.word.slug);
      return NextResponse.redirect(duplicate, 303);
    }
    return NextResponse.redirect(new URL(`/slovotvor/${result.word.slug}`, appBaseUrl()), 303);
  } catch (error) {
    const target = new URL("/slovotvor", appBaseUrl());
    target.searchParams.set("error", error instanceof SlovotvorPublicationError ? error.code : "failed");
    return NextResponse.redirect(target, 303);
  }
}
