import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentParticipant } from "@/lib/session";
import { downloadTelegramProfilePhoto } from "@/lib/telegram-bot-profile";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function oidcPictureFallback(value: unknown): NextResponse | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || (url.hostname === "api.telegram.org" && url.pathname.startsWith("/file/bot"))) return null;
    const response = NextResponse.redirect(url);
    response.headers.set("cache-control", "private, no-store");
    response.headers.set("vary", "Cookie");
    return response;
  } catch {
    return null;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ participantId: string }> }) {
  const viewer = await getCurrentParticipant();
  if (!viewer) return new NextResponse("Unauthorized", { status: 401 });
  const { participantId } = await params;
  if (!UUID.test(participantId)) return new NextResponse("Not found", { status: 404 });

  const result = await pool.query(
    `SELECT e.bot_profile->'photo'->>'file_id' AS file_id,
            e.bot_profile->>'photo_count' AS photo_count,
            e.avatar_url AS oidc_picture
       FROM external_identities e
      WHERE e.participant_id = $1::uuid AND e.provider = 'telegram'
        AND EXISTS (
          SELECT 1 FROM events login
           WHERE login.participant_id = e.participant_id
             AND login.event_type = 'participant.logged_in'
        )`,
    [participantId],
  );
  const identity = result.rows[0];
  if (!identity) return new NextResponse("Not found", { status: 404 });
  const fallback = oidcPictureFallback(identity.oidc_picture);
  const fileId = identity.photo_count === "0" ? null : identity.file_id;
  if (typeof fileId !== "string" || !fileId) return fallback ?? new NextResponse("Not found", { status: 404 });

  const photo = await downloadTelegramProfilePhoto(fileId);
  if (!photo || !IMAGE_TYPES.has(photo.contentType)) {
    return fallback ?? new NextResponse("Photo unavailable", { status: 503 });
  }
  return new NextResponse(photo.body, {
    headers: {
      "content-type": photo.contentType,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      vary: "Cookie",
    },
  });
}
