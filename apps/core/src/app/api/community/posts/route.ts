import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/config";
import { communityFromParams, createCommunityPost, deleteCommunityPost,
  CommunityMembershipError, CommunityPostValidationError, communityHref } from "@/lib/communities";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  const form = await request.formData();
  const rawHref = form.get("community");
  if (typeof rawHref !== "string" || !rawHref.startsWith("/participants?")) {
    return NextResponse.redirect(new URL("/participants", appBaseUrl()), 303);
  }
  const query = new URL(rawHref, appBaseUrl()).searchParams;
  const community = communityFromParams(Object.fromEntries(query));
  if (!community) return NextResponse.redirect(new URL("/participants", appBaseUrl()), 303);
  const returnUrl = new URL(communityHref(community), appBaseUrl());
  try {
    if (form.get("action") === "delete") {
      await deleteCommunityPost(community, participant.id, String(form.get("post_id") ?? ""));
    } else {
      await createCommunityPost(community, participant.id, form.get("body"));
    }
    returnUrl.searchParams.set("post", "saved");
  } catch (error) {
    if (!(error instanceof CommunityPostValidationError || error instanceof CommunityMembershipError)) throw error;
    returnUrl.searchParams.set("post", "invalid");
  }
  return NextResponse.redirect(returnUrl, 303);
}
