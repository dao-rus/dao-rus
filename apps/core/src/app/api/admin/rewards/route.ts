import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl, hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { parseDarusAmount, RewardRuleValidationError, saveRewardRule } from "@/lib/tokenization";

export const runtime = "nodejs";

function rewardRedirect(status: string) {
  const url = new URL("/admin/rewards", appBaseUrl());
  url.searchParams.set("reward_update", status);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  if (!hasPrototypeAdminAccess(participant.id)) return new NextResponse("Forbidden", { status: 403 });
  try {
    const form = await request.formData();
    const amount = parseDarusAmount(form.get("amount"));
    const active = form.get("active") === "on";
    const changed = await saveRewardRule(participant.id, amount, active);
    return rewardRedirect(changed ? "updated" : "unchanged");
  } catch (error) {
    if (error instanceof RewardRuleValidationError) return rewardRedirect("invalid");
    throw error;
  }
}
