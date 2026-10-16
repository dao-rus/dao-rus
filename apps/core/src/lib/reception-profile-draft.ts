import type { Pool } from "pg";
import { pool } from "./db";
import { appBaseUrl, telegramReceptionConfig } from "./config";
import { readInterfaceTexts } from "./interface-texts";
import { receptionApplicationButton } from "./reception-voice";
import { extractReceptionProfile } from "./reception-profile-extraction";

export async function createReceptionProfileDraft(
  telegramUserId: string, text: string, updateId: number, database: Pool = pool,
): Promise<boolean> {
  const extracted = extractReceptionProfile(text);
  if (!extracted) return false;
  const config = telegramReceptionConfig();
  const texts = (await readInterfaceTexts()).values;
  const button = receptionApplicationButton(appBaseUrl(), config.miniAppEnabled, texts["reception.apply.button"]);
  const c = await database.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`reception-application:${telegramUserId}`]);
    const inserted = await c.query(`INSERT INTO reception_applications
      (telegram_user_id, city, occupation, age, publish_age, education, family_status, status, source_message_update_id)
      VALUES ($1,$2,$3,$4,false,$5,$6,'draft',$7)
      ON CONFLICT (telegram_user_id) DO NOTHING RETURNING id`,
      [telegramUserId, extracted.city, extracted.occupation, extracted.age, extracted.education, extracted.familyStatus, updateId]);
    const current = await c.query<{ id: string; status: string; source_message_update_id: number | null; draft_prompt_sent_at: Date | null }>(
      "SELECT id, status, source_message_update_id, draft_prompt_sent_at FROM reception_applications WHERE telegram_user_id=$1 FOR UPDATE",
      [telegramUserId]);
    const draft = current.rows[0];
    if (!draft || draft.status !== "draft" || draft.draft_prompt_sent_at || (!inserted.rowCount && draft.source_message_update_id === updateId)) {
      await c.query("COMMIT");
      return true;
    }
    if (!config.token || !button) {
      await c.query("COMMIT");
      return true;
    }
    try {
      const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ chat_id: Number(telegramUserId), text: texts["reception.apply.prefill"],
          reply_markup: { inline_keyboard: [[button]] } }),
      });
      const body = await response.json().catch(() => null) as { ok?: boolean } | null;
      if (!response.ok || !body?.ok) throw new Error("prompt_failed");
      await c.query("UPDATE reception_applications SET draft_prompt_sent_at=now(), draft_prompt_error_code=NULL WHERE id=$1 AND draft_prompt_sent_at IS NULL", [draft.id]);
    } catch {
      await c.query("UPDATE reception_applications SET draft_prompt_error_code='telegram_unknown' WHERE id=$1 AND draft_prompt_sent_at IS NULL", [draft.id]);
    }
    await c.query("COMMIT");
    return true;
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}
