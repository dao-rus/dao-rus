import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl, hasPrototypeAdminAccess } from "@/lib/config";
import { getCurrentParticipant } from "@/lib/session";
import { listCloserGoals, saveCloserGoals } from "@/lib/closer";
import { SignalValidationError } from "@/lib/signals";

export const runtime = "nodejs";

function closerRedirect(status: string) {
  const url = new URL("/admin/closer", appBaseUrl());
  url.searchParams.set("closer_update", status);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(appBaseUrl()).origin) return new NextResponse("Forbidden", { status: 403 });
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  if (!hasPrototypeAdminAccess(participant.id)) return new NextResponse("Forbidden", { status: 403 });
  try {
    const form = await request.formData();
    const updates = (await listCloserGoals()).map((goal) => ({ key: goal.key, displayName: form.get(`name.${goal.key}`),
      asksGender: form.get(`gender.${goal.key}`) === "on", enabled: form.get(`enabled.${goal.key}`) === "on" }));
    const newName = form.get("new_name"), newKey = form.get("new_key");
    const added = (typeof newName === "string" && newName.trim()) || (typeof newKey === "string" && newKey.trim())
      ? { key: typeof newKey === "string" ? newKey.trim() : newKey, displayName: newName, asksGender: form.get("new_gender") === "on" } : undefined;
    return closerRedirect(await saveCloserGoals(participant.id, updates, added) ? "updated" : "unchanged");
  } catch (error) {
    if (error instanceof SignalValidationError) return closerRedirect("invalid");
    throw error;
  }
}
