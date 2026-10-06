import type { SignalDatabase, SignalReader } from "./signals";

const uuidPattern = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export class SignalReactionUnavailableError extends Error {
  constructor() { super("Signal reaction unavailable"); this.name = "SignalReactionUnavailableError"; }
}

export async function readSignalReactionStateWithDatabase(
  database: SignalReader, signalId: string, viewerId: string,
): Promise<{ count: number; reacted: boolean }> {
  const result = await database.query(
    `SELECT count(reaction.id)::integer AS count,
            bool_or(reaction.actor_participant_id = $2::uuid) AS reacted
       FROM profile_signals signal
       LEFT JOIN signal_reactions reaction ON reaction.signal_id = signal.id AND reaction.revoked_at IS NULL
      WHERE signal.id = $1::uuid AND (signal.participant_id = $2::uuid OR
        (signal.status = 'active' AND signal.visibility IN ('public', 'members', 'network_blind')))
      GROUP BY signal.id`,
    [signalId, viewerId],
  );
  return { count: Number(result.rows[0]?.count ?? 0), reacted: Boolean(result.rows[0]?.reacted) };
}

export async function readSignalReactionState(signalId: string, viewerId: string) {
  const { pool } = await import("./db");
  return readSignalReactionStateWithDatabase(pool, signalId, viewerId);
}

export async function setSignalReactionWithDatabase(
  database: SignalDatabase, actorId: string, signalId: string, active: boolean,
): Promise<boolean> {
  if (!uuidPattern.test(signalId)) throw new SignalReactionUnavailableError();
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const allowed = await client.query(
      `SELECT id FROM profile_signals WHERE id = $1::uuid AND participant_id <> $2::uuid
        AND status = 'active' AND visibility IN ('public', 'members', 'network_blind') FOR SHARE`,
      [signalId, actorId],
    );
    if (!allowed.rowCount) throw new SignalReactionUnavailableError();
    const changed = active
      ? await client.query(
          `INSERT INTO signal_reactions(signal_id, actor_participant_id) VALUES ($1::uuid, $2::uuid)
           ON CONFLICT (signal_id, actor_participant_id) WHERE revoked_at IS NULL DO NOTHING
           RETURNING id`, [signalId, actorId],
        )
      : await client.query(
          `UPDATE signal_reactions SET revoked_at = now()
            WHERE signal_id = $1::uuid AND actor_participant_id = $2::uuid AND revoked_at IS NULL
            RETURNING id`, [signalId, actorId],
        );
    if (changed.rowCount) {
      await client.query(
        `INSERT INTO events(event_type, participant_id, payload) VALUES ($1, $2::uuid, $3::jsonb)`,
        [active ? "signal.reaction_added" : "signal.reaction_removed", actorId,
          JSON.stringify({ signal_id: signalId, reaction_id: String(changed.rows[0].id) })],
      );
    }
    await client.query("COMMIT");
    return Boolean(changed.rowCount);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original error. */ }
    throw error;
  } finally { client.release(); }
}

export async function setSignalReaction(actorId: string, signalId: string, active: boolean) {
  const { pool } = await import("./db");
  return setSignalReactionWithDatabase(pool, actorId, signalId, active);
}

// Guests only see the like count of a publicly readable Signal; they never have a reaction of their own.
export async function readPublicSignalReactionCountWithDatabase(database: SignalReader, signalId: string): Promise<number> {
  if (!uuidPattern.test(signalId)) return 0;
  const result = await database.query(
    `SELECT count(reaction.id)::integer AS count
       FROM profile_signals signal
       LEFT JOIN signal_reactions reaction ON reaction.signal_id = signal.id AND reaction.revoked_at IS NULL
      WHERE signal.id = $1::uuid AND signal.status = 'active' AND signal.visibility = 'public'
      GROUP BY signal.id`,
    [signalId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function readPublicSignalReactionCount(signalId: string) {
  const { pool } = await import("./db");
  return readPublicSignalReactionCountWithDatabase(pool, signalId);
}
