import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl, hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { launchTechnicalBroadcast } from "@/lib/guardian-campaign";
import { GuardianCampaignValidationError, parseTechnicalBroadcastDraft } from "../../../../../lib/guardian-campaign-input";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  if (!hasPrototypeAdminAccess(participant.id)) return new NextResponse("Forbidden", { status: 403 });
  try {
    const form = await request.formData();
    const draft = parseTechnicalBroadcastDraft({ text: form.get("text"), city: form.get("city") ?? "", interests: form.getAll("interest"),
      core: form.get("core") === "on", telegram: form.get("telegram") === "on", submissionId: form.get("submission_id") });
    const result = await launchTechnicalBroadcast(participant.id, draft);
    const url = new URL("/admin/guardian", appBaseUrl());
    url.searchParams.set("broadcast", result.campaign.id);
    if (draft.city) url.searchParams.set("city", draft.city);
    for (const interest of draft.interests) url.searchParams.append("interest", interest);
    return NextResponse.redirect(url, 303);
  } catch (error) {
    if (error instanceof GuardianCampaignValidationError) return new NextResponse(error.message, { status: 400 });
    throw error;
  }
}
