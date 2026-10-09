import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { castVote, closePoll, getPollView, validPollId } from "@/lib/veche-polls";
export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store" };
type Context = { params: Promise<{ proposalId: string }> };
export async function GET(_request: NextRequest, { params }: Context) {
  if (!await getCurrentParticipant()) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: privateHeaders });
  const { proposalId } = await params;
  const view = await getPollView(proposalId);
  return view ? NextResponse.json(view, { headers: privateHeaders }) : NextResponse.json({ error: "Not found" }, { status: 404, headers: privateHeaders });
}
export async function POST(request: NextRequest, { params }: Context) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(appBaseUrl()).origin) return new NextResponse("Forbidden", { status: 403 });
  const participant = await getCurrentParticipant();
  if (!participant) return new NextResponse("Unauthorized", { status: 401 });
  const { proposalId } = await params;
  if (!validPollId(proposalId)) return new NextResponse("Not found", { status: 404 });
  const url = new URL(`/veche/${proposalId}`, appBaseUrl());
  try {
    const form = await request.formData();
    if (form.get("action") === "close") await closePoll(proposalId, participant.id);
    else await castVote(proposalId, participant.id, form.get("choice"));
    url.searchParams.set("outcome", "saved");
  } catch {
    // Never echo the submitted choice or log DB exceptions containing ballot parameters.
    url.searchParams.set("outcome", "failed");
  }
  return NextResponse.redirect(url, 303);
}
