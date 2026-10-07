import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "../../../../lib/config";
import { getCurrentParticipant } from "../../../../lib/session";
import { markRewardShown } from "../../../../lib/reward-announcements";

export const runtime = "nodejs";

// Reported by the page that actually played the reward animation, so a prefetched or
// never-rendered page cannot use it up.
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(appBaseUrl()).origin) return new NextResponse("Forbidden", { status: 403 });
  const participant = await getCurrentParticipant();
  if (!participant) return new NextResponse("Unauthorized", { status: 401 });
  await markRewardShown(participant.id, (await request.formData()).get("entry_id"));
  return new NextResponse(null, { status: 204 });
}
