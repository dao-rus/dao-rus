import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { pool } from "./db";
import { telegramReceptionConfig } from "./config";
import { receptionTelegramName, receptionTelegramUsername } from "./reception-telegram-profile";

type Config = ReturnType<typeof telegramReceptionConfig>;
type Transport = typeof fetch;
const lockKey = (id: string) => `reception-application:${id}`;

export function receptionPublicationText(a: { telegram_name: string | null; telegram_username: string | null; city: string; occupation: string; age: number | null; publish_age: boolean }) {
  return [a.telegram_name || "Кандидат", a.telegram_username ? `@${a.telegram_username}` : null,
    `Город: ${a.city}`, `Род занятий: ${a.occupation}`,
    a.publish_age && a.age !== null ? `Возраст: ${a.age}` : null].filter(Boolean).join("\n");
}

// No descriptions from Telegram or exception objects cross this boundary.
async function callBot(config: Config, method: string, payload: object, transport: Transport) {
  try {
    const response = await transport(`https://api.telegram.org/bot${config.token}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json();
    if (response.ok && body?.ok === true) return { result: body.result, code: null, retry: 0, ambiguous: false };
    const code = Number(body?.error_code);
    if (body?.ok === false && [400, 401, 403, 404, 429].includes(code) && response.status < 500) {
      if (method === "editMessageText" && code === 400 && /^Bad Request: message is not modified\b/i.test(String(body.description))) {
        return { result: true, code: null, retry: 0, ambiguous: false };
      }
      const delay = Number(body?.parameters?.retry_after);
      return { result: null, code: `telegram_${code}`, retry: Number.isFinite(delay) && delay > 0 ? Math.ceil(delay) : 60, ambiguous: false };
    }
    return { result: null, code: "telegram_unknown", retry: 0, ambiguous: true };
  } catch {
    return { result: null, code: "telegram_unknown", retry: 0, ambiguous: true };
  }
}

// A durable attempted_at is the boundary: after it, a lost process may have sent a message.
// Advisory locks are shared with application writes and manual recovery. Never expire an active sender.
export async function expireReceptionPublicationClaims(database: Pool = pool) {
  const stale = (await database.query(`SELECT d.id, a.telegram_user_id FROM reception_application_deliveries d
    JOIN reception_applications a ON a.id=d.application_id WHERE d.kind='publication'
    AND d.status='processing' AND d.claimed_at < now()-interval '10 minutes'`)).rows;
  for (const row of stale) {
    const c = await database.connect();
    try {
      await c.query("BEGIN");
      const locked = (await c.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked", [lockKey(row.telegram_user_id)])).rows[0].locked;
      if (locked) await c.query(`UPDATE reception_application_deliveries SET
        status=CASE WHEN attempted_at IS NULL THEN 'pending' ELSE 'needs_review' END,
        error_code=CASE WHEN attempted_at IS NULL THEN NULL ELSE 'process_interrupted' END,
        claim_token=NULL, claimed_at=NULL, version=version+1, updated_at=now()
        WHERE id=$1 AND status='processing' AND claimed_at < now()-interval '10 minutes'`, [row.id]);
      await c.query("COMMIT");
    } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
  }
}

export async function processNextReceptionPublication(database: Pool = pool, config = telegramReceptionConfig(), transport: Transport = fetch) {
  if (!config.publicationsEnabled || !config.token || !config.forumChatId || !config.topicId) return null;
  if (!/^-\d+$/.test(config.forumChatId) || !/^\d+$/.test(config.topicId) || Number(config.topicId) < 1) return null;
  const token = randomUUID();
  const claimed = (await database.query(`WITH candidate AS (
    SELECT d.id FROM reception_application_deliveries d JOIN reception_applications a ON a.id=d.application_id
    WHERE d.kind='publication' AND (d.status='pending' OR (d.status='delivered' AND a.revision>d.delivered_revision))
    AND (d.retry_at IS NULL OR d.retry_at<=now()) ORDER BY d.updated_at FOR UPDATE OF d SKIP LOCKED LIMIT 1
  ) UPDATE reception_application_deliveries d SET status='processing', claim_token=$1, claimed_at=now(),
    attempted_at=NULL, attempted_revision=NULL, attempted_text=NULL, version=version+1, updated_at=now()
    FROM candidate WHERE d.id=candidate.id RETURNING d.id, d.application_id`, [token])).rows[0];
  if (!claimed) return null;
  const c = await database.connect();
  let locked = false;
  let attempted = false;
  let advisoryKey: string | null = null;
  try {
    const identity = (await c.query("SELECT telegram_user_id FROM reception_applications WHERE id=$1", [claimed.application_id])).rows[0];
    advisoryKey = lockKey(identity.telegram_user_id);
    locked = (await c.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [advisoryKey])).rows[0].locked;
    if (!locked) {
      await c.query("UPDATE reception_application_deliveries SET status='pending', claim_token=NULL, claimed_at=NULL WHERE id=$1 AND claim_token=$2", [claimed.id, token]);
      return { id: claimed.id, status: "pending" };
    }
    const d = (await c.query("SELECT * FROM reception_application_deliveries WHERE id=$1 AND claim_token=$2 AND status='processing'", [claimed.id, token])).rows[0];
    if (!d) return null;
    const a = (await c.query("SELECT * FROM reception_applications WHERE id=$1", [claimed.application_id])).rows[0];
    if (!a.telegram_name) {
      // Old applications have no signed display snapshot. A read-only getChat is safe to retry.
      const profile = await callBot(config, "getChat", { chat_id: a.telegram_user_id }, transport);
      const chat = profile.result;
      if (!chat || chat.type !== "private" || String(chat.id) !== a.telegram_user_id || typeof chat.first_name !== "string") {
        await c.query(`UPDATE reception_application_deliveries SET status='pending', error_code='profile_unavailable',
          retry_at=now()+make_interval(secs=>$3), claim_token=NULL, claimed_at=NULL, version=version+1 WHERE id=$1 AND claim_token=$2`, [d.id, token, Math.max(60, profile.retry)]);
        return { id: d.id, status: "pending" };
      }
      a.telegram_name = receptionTelegramName(chat.first_name, typeof chat.last_name === "string" ? chat.last_name : null);
      a.telegram_username = receptionTelegramUsername(typeof chat.username === "string" ? chat.username : null);
      await c.query("UPDATE reception_applications SET telegram_name=$2, telegram_username=$3 WHERE id=$1", [a.id, a.telegram_name, a.telegram_username]);
    }
    if (d.telegram_chat_id && (String(d.telegram_chat_id) !== config.forumChatId || String(d.telegram_topic_id) !== config.topicId)) {
      await c.query("UPDATE reception_application_deliveries SET status='needs_review', error_code='target_changed', claim_token=NULL, claimed_at=NULL, version=version+1 WHERE id=$1 AND claim_token=$2", [d.id, token]);
      return { id: d.id, status: "needs_review" };
    }
    const text = receptionPublicationText(a);
    await c.query(`UPDATE reception_application_deliveries SET attempted_at=now(), attempted_revision=$3,
      attempted_text=$4, telegram_chat_id=$5, telegram_topic_id=$6, attempts=attempts+1
      WHERE id=$1 AND claim_token=$2 AND status='processing'`, [d.id, token, a.revision, text, config.forumChatId, config.topicId]);
    attempted = true;
    const edit = d.telegram_message_id !== null;
    const payload = edit ? { chat_id: config.forumChatId, message_id: Number(d.telegram_message_id), text }
      : { chat_id: config.forumChatId, ...(Number(config.topicId) === 1 ? {} : { message_thread_id: Number(config.topicId) }), text };
    // Plain text, deliberately no parse_mode or client entities.
    const response = await callBot(config, edit ? "editMessageText" : "sendMessage", payload, transport);
    const message = response.result;
    const valid = edit && message === true || message && Number.isSafeInteger(message.message_id) && message.message_id > 0
      && String(message.chat?.id) === config.forumChatId && (!edit || String(message.message_id) === String(d.telegram_message_id));
    const status = valid ? "delivered" : response.ambiguous || !response.code ? "needs_review" : "pending";
    await c.query(`UPDATE reception_application_deliveries SET status=$3, delivered_revision=CASE WHEN $3='delivered' THEN $4 ELSE delivered_revision END,
      telegram_message_id=COALESCE($5,telegram_message_id), error_code=$6,
      retry_at=CASE WHEN $3='pending' THEN now()+make_interval(secs=>$7) ELSE NULL END,
      claim_token=NULL, claimed_at=NULL, version=version+1, updated_at=now() WHERE id=$1 AND claim_token=$2 AND status='processing'`,
    [d.id, token, status, a.revision, valid ? (edit ? d.telegram_message_id : message.message_id) : null,
      valid ? null : response.code ?? "telegram_unknown", Math.max(response.retry, Math.min(3600, 60 * 2 ** Math.min(d.attempts, 6)))]);
    return { id: d.id, status };
  } catch (error) {
    // If recording the result fails, leave the durable claim for stale recovery.
    if (!attempted) await c.query(`UPDATE reception_application_deliveries SET status='pending', retry_at=now()+interval '60 seconds',
      claim_token=NULL, claimed_at=NULL, version=version+1 WHERE id=$1 AND claim_token=$2 AND attempted_at IS NULL`, [claimed.id, token]);
    throw error;
  } finally {
    let destroy = false;
    if (locked) {
      try { await c.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [advisoryKey]); }
      catch { destroy = true; }
    }
    c.release(destroy);
  }
}
