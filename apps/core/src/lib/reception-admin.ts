import type { Pool } from "pg";
import { pool } from "./db";
import { hasPrototypeAdminAccess } from "./config";
import { inspectTelegramParticipantById, TelegramParticipantIdentityConflictError } from "./telegram-participant";

export class ReceptionAdminError extends Error {}
function authorize(actor: string) {
  if (!hasPrototypeAdminAccess(actor)) throw new ReceptionAdminError("forbidden");
}
export function receptionMessageLink(chat: string | null, message: string | null) {
  return chat && message && /^-100\d+$/.test(chat) && /^\d+$/.test(message)
    ? `https://t.me/c/${chat.slice(4)}/${message}` : null;
}
export const receptionDeliveryErrors: Record<string, string> = {
  telegram_unknown: "Telegram не подтвердил результат. Требуется ручная сверка.",
  process_interrupted: "Процесс прервался после отметки о возможной отправке. Требуется сверка.",
  profile_unavailable: "Не удалось получить проверенное Telegram-имя. Отправка не выполнялась.",
  target_changed: "Изменилась тема назначения. Автоматическая отправка остановлена.",
  telegram_400: "Telegram отклонил запрос. Проверьте сообщение и настройки темы.",
  telegram_401: "Telegram отклонил авторизацию бота.",
  telegram_403: "Telegram отказал боту в доступе.",
  telegram_404: "Telegram не нашёл назначение.",
  telegram_429: "Ограничение частоты Telegram. Повтор отложен.",
  membership_unavailable: "Членство не подтверждено. Приглашение не отправлялось; проверка будет повторена.",
  already_joined: "Telegram подтвердил членство в форуме. Приглашение не требуется.",
  legacy_invitation_sent: "Старый механизм уже подтвердил отправку приглашения. Повтор заблокирован до ручной сверки.",
  legacy_invitation_unknown: "Старый механизм ранее пытался отправить приглашение. Результат неизвестен; нужна ручная сверка.",
  invite_unavailable: "Ссылка на форум не настроена или недопустима. Приглашение не отправлялось.",
};
export async function listReceptionApplications(actor: string, database: Pool = pool, page = 1) {
  authorize(actor);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) throw new ReceptionAdminError("invalid");
  // Consent to forum publication is also the conservative journal policy.
  // Strip the generated age line from historical attempts, including after consent withdrawal.
  return (await database.query(`SELECT a.id, a.telegram_user_id, a.telegram_name, a.telegram_username,
    a.city, a.occupation, a.education, a.family_status, CASE WHEN a.publish_age THEN a.age ELSE NULL END AS age,
    a.created_at, a.updated_at, a.status AS application_status, a.revision,
    d.status, d.version, d.delivered_revision, d.attempted_revision, d.attempted_at,
    regexp_replace(d.attempted_text, chr(10)||'Возраст: [0-9]+$', '') AS review_text,
    d.telegram_chat_id, d.telegram_topic_id, d.telegram_message_id, d.attempts, d.retry_at, d.error_code,
    i.status AS invitation_status, i.version AS invitation_version, i.requested_by, i.requested_at,
    i.telegram_chat_id AS invitation_chat_id, i.telegram_message_id AS invitation_message_id,
    i.attempted_at AS invitation_attempted_at, i.attempts AS invitation_attempts,
    i.error_code AS invitation_error_code, i.retry_at AS invitation_retry_at,
    (SELECT o.forum_status FROM participant_forum_onboarding o JOIN external_identities e ON e.participant_id=o.participant_id
      WHERE e.provider='telegram' AND e.external_user_id=a.telegram_user_id ORDER BY o.observed_at DESC LIMIT 1) AS forum_status
    FROM reception_applications a LEFT JOIN reception_application_deliveries d ON d.application_id=a.id
    AND d.kind='publication' LEFT JOIN reception_application_deliveries i ON i.application_id=a.id
    AND i.kind='invitation' ORDER BY a.updated_at DESC, a.id LIMIT 50 OFFSET $1`, [(page - 1) * 50])).rows;
}

export async function requestReceptionInvitation(actor: string, id: string, database: Pool = pool) {
  authorize(actor);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new ReceptionAdminError("invalid");
  const c = await database.connect();
  try {
    await c.query("BEGIN");
    const a = (await c.query("SELECT telegram_user_id, revision FROM reception_applications WHERE id=$1", [id])).rows[0];
    if (!a) throw new ReceptionAdminError("not_found");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`reception-application:${a.telegram_user_id}`]);
    if ((await c.query("SELECT id FROM reception_application_deliveries WHERE application_id=$1 AND kind='invitation'", [id])).rowCount) {
      await c.query("COMMIT"); return;
    }
    // An older auto-invite may predate this application. Preserve ambiguity rather than duplicating it.
    let participantId: string | null;
    try { participantId = await inspectTelegramParticipantById(c, a.telegram_user_id); }
    catch (error) {
      if (error instanceof TelegramParticipantIdentityConflictError) throw new ReceptionAdminError("identity_conflict");
      throw error;
    }
    const old = participantId ? (await c.query("SELECT invitation_attempted_at, invitation_sent_at, invitation_blocked_at FROM participant_forum_onboarding WHERE participant_id=$1", [participantId])).rows[0] : null;
    const uncertain = old?.invitation_attempted_at && !old.invitation_blocked_at;
    const code = uncertain ? (old.invitation_sent_at ? "legacy_invitation_sent" : "legacy_invitation_unknown") : null;
    await c.query(`INSERT INTO reception_application_deliveries(application_id,kind,status,requested_by,requested_at,
      telegram_chat_id,attempted_at,attempted_revision,error_code) VALUES ($1,'invitation',$2,$3,now(),$4,$5,$6,$7)`,
      [id, uncertain ? "needs_review" : "pending", actor, uncertain ? a.telegram_user_id : null,
        uncertain ? old.invitation_attempted_at : null, uncertain ? a.revision : null, code]);
    await c.query("INSERT INTO events(event_type,participant_id,payload) VALUES ('reception.invitation_requested',$1,$2::jsonb)",
      [actor, JSON.stringify({ applicationId: id, status: uncertain ? "needs_review" : "pending", errorCode: code })]);
    await c.query("COMMIT");
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}

export async function reviewReceptionDelivery(actor: string, input: {
  id: string; version: number; action: "inspect" | "confirm" | "retry"; verified: boolean; messageId?: string; kind?: "publication" | "invitation";
}, database: Pool = pool) {
  authorize(actor);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id) || !Number.isSafeInteger(input.version) || input.version < 1
    || !["inspect", "confirm", "retry"].includes(input.action)
    || (input.kind !== undefined && !["publication", "invitation"].includes(input.kind))) throw new ReceptionAdminError("invalid");
  const c = await database.connect();
  try {
    await c.query("BEGIN");
    const a = (await c.query("SELECT telegram_user_id FROM reception_applications WHERE id=$1", [input.id])).rows[0];
    if (!a) throw new ReceptionAdminError("not_found");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`reception-application:${a.telegram_user_id}`]);
    const kind = input.kind ?? "publication";
    const d = (await c.query("SELECT * FROM reception_application_deliveries WHERE application_id=$1 AND kind=$2 FOR UPDATE", [input.id, kind])).rows[0];
    if (!d) throw new ReceptionAdminError("not_found");
    if (d.version !== input.version || d.status === "processing") throw new ReceptionAdminError("conflict");
    if (input.action !== "inspect") {
      if (d.status !== "needs_review" || !input.verified) throw new ReceptionAdminError("confirmation_required");
      if (input.action === "confirm") {
        if (!d.attempted_revision || !d.telegram_chat_id || !/^\d{1,10}$/.test(input.messageId ?? "")
          || Number(input.messageId) < 1 || (d.telegram_message_id && String(d.telegram_message_id) !== input.messageId)) throw new ReceptionAdminError("invalid");
        await c.query(`UPDATE reception_application_deliveries SET status='delivered', delivered_revision=attempted_revision,
          telegram_message_id=$2, error_code=NULL, retry_at=NULL, version=version+1, updated_at=now() WHERE id=$1`, [d.id, input.messageId]);
      } else {
        // A known original message is never replaced by a new send: retry means edit it.
        await c.query(`UPDATE reception_application_deliveries SET status='pending', error_code=NULL,
          retry_at=NULL, version=version+1, updated_at=now() WHERE id=$1`, [d.id]);
      }
    }
    await c.query(`INSERT INTO events(event_type,participant_id,payload) VALUES ('reception.delivery_review',$1,$2::jsonb)`,
      [actor, JSON.stringify({ applicationId: input.id, kind, action: input.action, version: d.version,
        attemptedRevision: d.attempted_revision, messageId: input.action === "confirm" ? input.messageId : d.telegram_message_id,
        manuallyVerified: input.action !== "inspect" && input.verified })]);
    await c.query("COMMIT");
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}
