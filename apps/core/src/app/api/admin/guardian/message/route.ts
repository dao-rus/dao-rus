import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl, hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { dispatchGuardianMessage, previewGuardianMessage } from "@/lib/guardian-campaign";
import { GuardianCampaignValidationError, parseGuardianMessageDraft } from "../../../../../lib/guardian-campaign-input";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  if (!hasPrototypeAdminAccess(participant.id)) return new NextResponse("Forbidden", { status: 403 });
  try {
    const form = await request.formData();
    const draft = parseGuardianMessageDraft({ text: form.get("text"), city: form.get("city") ?? "",
      interests: form.getAll("interest"), conditions: form.getAll("condition"), preset: form.get("preset"), template: form.get("template"),
      core: form.get("core") === "on", telegram: form.get("telegram") === "on", submissionId: form.get("submission_id") });
    if (form.get("stage") === "preview") return NextResponse.json(await previewGuardianMessage(draft));
    if (form.get("confirm") !== "send") return new NextResponse("Message confirmation required", { status: 400 });
    const result = await dispatchGuardianMessage(participant.id, draft);
    const url = new URL("/admin/guardian", appBaseUrl());
    url.searchParams.set("message", result.campaign.id);
    if (draft.preset) url.searchParams.set("preset", draft.preset);
    return NextResponse.redirect(url, 303);
  } catch (error) {
    if (error instanceof GuardianCampaignValidationError) return new NextResponse(error.message, { status: 400 });
    throw error;
  }
}
