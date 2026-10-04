import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl, hasPrototypeAdminAccess } from "@/lib/config";
import { GuardianCampaignValidationError, parseGuardianCampaignDraft } from "../../../../../lib/guardian-campaign-input";
import { launchGuardianCampaign } from "@/lib/guardian-campaign";
import { guardianScenario } from "../../../../../lib/guardian-campaign-scenarios";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  if (!hasPrototypeAdminAccess(participant.id)) return new NextResponse("Forbidden", { status: 403 });

  const form = await request.formData();
  if (form.get("confirm") !== "launch") return new NextResponse("Campaign confirmation required", { status: 400 });
  try {
    const draft = parseGuardianCampaignDraft({ text: form.get("text") });
    const scenario = guardianScenario(form.get("scenario"));
    const residence = form.get("residence");
    const result = await launchGuardianCampaign(participant.id, {
      scenario: scenario.type, text: draft.text,
      ...(scenario.type === "town_meeting" ? { residenceKey: typeof residence === "string" ? residence : "" } : {}),
    });
    const url = new URL("/admin/guardian", appBaseUrl());
    url.searchParams.set("scenario", scenario.type);
    url.searchParams.set("campaign", result.launched ? "launched" : "already");
    url.searchParams.set("campaign_id", result.campaign.id);
    return NextResponse.redirect(url, 303);
  } catch (error) {
    if (error instanceof GuardianCampaignValidationError) return new NextResponse(error.message, { status: 400 });
    throw error;
  }
}
