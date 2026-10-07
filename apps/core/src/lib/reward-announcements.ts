import type { SignalReader } from "./signals";
import { formatDarusAmount } from "./tokenization";

// The first need/have reward is granted when another participant responds, usually while the
// author is away. It is shown to them once, at their next visit to any Core page.
export type PendingReward = { id: string; amount: string };
const SOURCES = ["need_first_created", "have_first_created"];

export async function readPendingRewardWithDatabase(database: SignalReader, participantId: string): Promise<PendingReward | null> {
  const result = await database.query(
    `SELECT ledger.id, ledger.amount FROM darus_ledger ledger
      WHERE ledger.participant_id = $1::uuid AND ledger.source_type = ANY($2::text[])
        AND NOT EXISTS (SELECT 1 FROM reward_announcements shown WHERE shown.ledger_id = ledger.id)
      ORDER BY ledger.created_at, ledger.id LIMIT 1`, [participantId, SOURCES]);
  return result.rowCount ? { id: String(result.rows[0].id), amount: formatDarusAmount(String(result.rows[0].amount)) } : null;
}

// Only the owner of a ledger entry can mark it as shown; repeating it changes nothing.
export async function markRewardShownWithDatabase(database: SignalReader, participantId: string, ledgerId: unknown): Promise<boolean> {
  if (typeof ledgerId !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ledgerId)) return false;
  const result = await database.query(
    `INSERT INTO reward_announcements(ledger_id, participant_id)
     SELECT ledger.id, ledger.participant_id FROM darus_ledger ledger
      WHERE ledger.id = $2::uuid AND ledger.participant_id = $1::uuid
     ON CONFLICT (ledger_id) DO NOTHING RETURNING ledger_id`, [participantId, ledgerId]);
  return Boolean(result.rowCount);
}

export async function readPendingReward(participantId: string) { const { pool } = await import("./db"); return readPendingRewardWithDatabase(pool, participantId); }
export async function markRewardShown(participantId: string, ledgerId: unknown) { const { pool } = await import("./db"); return markRewardShownWithDatabase(pool, participantId, ledgerId); }
