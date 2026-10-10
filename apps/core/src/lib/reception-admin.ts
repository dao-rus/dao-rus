import type { Pool } from "pg";
import { pool } from "./db";
import { hasPrototypeAdminAccess } from "./config";

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
};
export async function listReceptionApplications(actor: string, database: Pool = pool, page = 1) {
  authorize(actor);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) throw new ReceptionAdminError("invalid");
  // Consent to forum publication is also the conservative journal policy.
  // Strip the generated age line from historical attempts, including after consent withdrawal.
  return (await database.query(`SELECT a.id, a.telegram_user_id, a.telegram_name, a.telegram_username,
    a.city, a.occupation, CASE WHEN a.publish_age THEN a.age ELSE NULL END AS age,
    a.created_at, a.updated_at, a.status AS application_status, a.revision,
    d.status, d.version, d.delivered_revision, d.attempted_revision, d.attempted_at,
    regexp_replace(d.attempted_text, chr(10)||'Возраст: [0-9]+$', '') AS review_text,
    d.telegram_chat_id, d.telegram_topic_id, d.telegram_message_id, d.attempts, d.retry_at, d.error_code
    FROM reception_applications a JOIN reception_application_deliveries d ON d.application_id=a.id
    AND d.kind='publication' ORDER BY a.updated_at DESC, a.id LIMIT 50 OFFSET $1`, [(page - 1) * 50])).rows;
}

export async function reviewReceptionDelivery(actor: string, input: {
  id: string; version: number; action: "inspect" | "confirm" | "retry"; verified: boolean; messageId?: string;
}, database: Pool = pool) {
  authorize(actor);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.id) || !Number.isSafeInteger(input.version) || input.version < 1
    || !["inspect", "confirm", "retry"].includes(input.action)) throw new ReceptionAdminError("invalid");
  const c = await database.connect();
  try {
    await c.query("BEGIN");
    const a = (await c.query("SELECT telegram_user_id FROM reception_applications WHERE id=$1", [input.id])).rows[0];
    if (!a) throw new ReceptionAdminError("not_found");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`reception-application:${a.telegram_user_id}`]);
    const d = (await c.query("SELECT * FROM reception_application_deliveries WHERE application_id=$1 AND kind='publication' FOR UPDATE", [input.id])).rows[0];
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
      [actor, JSON.stringify({ applicationId: input.id, action: input.action, version: d.version,
        attemptedRevision: d.attempted_revision, messageId: input.action === "confirm" ? input.messageId : d.telegram_message_id,
        manuallyVerified: input.action !== "inspect" && input.verified })]);
    await c.query("COMMIT");
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}
