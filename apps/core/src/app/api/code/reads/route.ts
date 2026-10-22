import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { markCodeCommentsRead } from "@/lib/code-comment-reads";

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return new NextResponse(null, { status: 401 });
  if (request.headers.get("origin") !== new URL(appBaseUrl()).origin) return new NextResponse(null, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  if (!Array.isArray(body) || body.length > 10000 || !body.every(id => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    return new NextResponse(null, { status: 400 });
  }
  await markCodeCommentsRead(participant.id, body);
  return new NextResponse(null, { status: 204 });
}
