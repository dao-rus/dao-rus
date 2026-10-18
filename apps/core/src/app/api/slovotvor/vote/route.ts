import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import {
  castSlovotvorVote,
  getSlovotvorWordById,
  SlovotvorVoteError,
} from "@/lib/slovotvor";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const wordId = String(form.get("wordId") ?? "");
  const choice = form.get("choice");
  const word = await getSlovotvorWordById(wordId);
  if (!word) return NextResponse.redirect(new URL("/slovotvor", appBaseUrl()), 303);

  const target = new URL(`/slovotvor/${word.slug}`, appBaseUrl());
  const participant = await getCurrentParticipant();
  if (!participant) {
    const login = new URL("/api/auth/telegram/start", appBaseUrl());
    login.searchParams.set("next", `/slovotvor/${word.slug}`);
    return NextResponse.redirect(login, 303);
  }

  try {
    await castSlovotvorVote(word.id, participant.id, choice);
  } catch (error) {
    if (!(error instanceof SlovotvorVoteError)) console.error("Slovotvor vote failed", error);
  }
  return NextResponse.redirect(target, 303);
}
