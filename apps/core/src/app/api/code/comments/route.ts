import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl, hasPrototypeAdminAccess } from "@/lib/config";
import {
  changeCodeComment,
  CodeCommentAccessError,
  CodeCommentRateLimitError,
  CodeCommentValidationError,
  parseCodeCommentAction,
  parseCodeSection,
} from "../../../../lib/code-comments";
import { getCurrentParticipant } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const participant = await getCurrentParticipant();
  if (!participant) return NextResponse.redirect(new URL("/", appBaseUrl()), 303);
  const form = await request.formData();
  try {
    const action = parseCodeCommentAction(form.get("action"));
    const section = parseCodeSection(form.get("section"));
    await changeCodeComment(participant.id, hasPrototypeAdminAccess(participant.id), {
      action, section, commentId: form.get("comment_id"), parentId: form.get("parent_id"),
      body: form.get("body"), reason: form.get("reason"),
    });
    const url = new URL("/code", appBaseUrl());
    url.searchParams.set("section", section);
    url.hash = section;
    return NextResponse.redirect(url, 303);
  } catch (error) {
    if (error instanceof CodeCommentRateLimitError) {
      return new NextResponse("Подождите 30 секунд перед новой публикацией.", { status: 429 });
    }
    if (error instanceof CodeCommentAccessError) {
      return new NextResponse("Действие недоступно.", { status: 403 });
    }
    if (error instanceof CodeCommentValidationError) {
      return new NextResponse("Проверьте текст и выбранный комментарий.", { status: 400 });
    }
    throw error;
  }
}
