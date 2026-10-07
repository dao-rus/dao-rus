import { createNotification } from "./notifications";
import { readInterfaceTexts, type InterfaceTextKey } from "./interface-texts";

// Content-free notices: neither the record, the goal nor the other side is named.
// One unread notice of a kind is enough, so repeated edits cannot flood a participant.
// Delivery is best-effort and must never fail the action that caused it.
export async function notifyCloser(participantIds: string[], kind: "match" | "dialog", actionUrl: string) {
  if (!participantIds.length) return;
  try {
    const { pool } = await import("./db");
    const { values: texts } = await readInterfaceTexts();
    const type = `closer.${kind}`;
    for (const participantId of participantIds) {
      const unread = await pool.query(
        "SELECT 1 FROM notifications WHERE participant_id = $1::uuid AND notification_type = $2 AND read_at IS NULL LIMIT 1",
        [participantId, type]);
      if (unread.rowCount) continue;
      await createNotification({ participantId, notificationType: type, sourceType: "system", queueTelegram: true,
        text: texts[`closer.notify_${kind}` as InterfaceTextKey], actionUrl, actionLabel: texts["closer.notify_action"] });
    }
  } catch (error) { console.error("Closer notification failed", error); }
}
