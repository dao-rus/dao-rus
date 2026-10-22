import { SignalValidationError, type SignalClient, type SignalDatabase, type SignalReader } from "./signals";
import { normalizeBoundedText } from "./profile-validation";

// «Ближе» (signal type `dating`). Matching uses only the keys the author chose:
// goal, city and, for goals that ask for it, gender. Free text is never compared.
export const CLOSER_TYPE_KEY = "dating";
export const CLOSER_ACTIVE_LIMIT = 3;

export type CloserGoal = { key: string; displayName: string; asksGender: boolean; enabled: boolean };
export type CloserKeys = {
  goalKey: string; anyCity: boolean; selfGender: "m" | "f" | null; seeksGender: "m" | "f" | "any" | null;
};
// Viewer-safe by construction: no owner, participant or profile field exists on a match.
export type CloserMatch = {
  mySignalId: string; signalId: string; goalName: string; city: string | null;
  label: string; description: string | null; encounterId: string | null;
};

export class CloserLimitError extends SignalValidationError {
  constructor() { super("Closer signal limit reached"); this.name = "CloserLimitError"; }
}
export class CloserUnavailableError extends Error {
  constructor() { super("Closer match is unavailable"); this.name = "CloserUnavailableError"; }
}

const uuidPattern = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function requiredUuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new CloserUnavailableError();
  return value;
}

function goalFromRow(row: Record<string, unknown>): CloserGoal {
  return { key: String(row.key), displayName: String(row.display_name),
    asksGender: Boolean(row.asks_gender), enabled: Boolean(row.enabled) };
}
export async function listCloserGoalsWithDatabase(database: SignalReader): Promise<CloserGoal[]> {
  const result = await database.query(
    "SELECT key, display_name, asks_gender, enabled FROM closer_goals ORDER BY position, key");
  return result.rows.map(goalFromRow);
}

// Adapter input is untrusted form data; the goal list is the catalogue read by the caller.
export function normalizeCloserKeys(
  input: { goal: unknown; city: unknown; self?: unknown; seeks?: unknown }, goals: CloserGoal[], hasResidence: boolean,
): CloserKeys {
  const goal = goals.find((entry) => entry.enabled && entry.key === input.goal);
  if (!goal) throw new SignalValidationError("Unknown or disabled closer goal");
  if (input.city !== "any" && input.city !== "city") throw new SignalValidationError("Invalid closer city");
  if (input.city === "city" && !hasResidence) throw new SignalValidationError("Residence is required for a city match");
  if (!goal.asksGender) return { goalKey: goal.key, anyCity: input.city === "any", selfGender: null, seeksGender: null };
  if (input.seeks !== "m" && input.seeks !== "f" && input.seeks !== "any") throw new SignalValidationError("Invalid closer gender");
  const self = input.self === undefined || input.self === null || input.self === "" ? null : input.self;
  if (self !== null && self !== "m" && self !== "f") throw new SignalValidationError("Invalid closer gender");
  return { goalKey: goal.key, anyCity: input.city === "any", selfGender: self, seeksGender: input.seeks };
}

function keysFromRow(row: Record<string, unknown>): CloserKeys {
  return { goalKey: String(row.goal_key), anyCity: Boolean(row.any_city),
    selfGender: (row.self_gender ?? null) as CloserKeys["selfGender"],
    seeksGender: (row.seeks_gender ?? null) as CloserKeys["seeksGender"] };
}

// Own records only: keys are as hidden as the record they belong to.
export async function listOwnCloserKeysWithDatabase(database: SignalReader, ownerId: string): Promise<Map<string, CloserKeys>> {
  const result = await database.query(
    `SELECT k.signal_id, k.goal_key, k.any_city, k.self_gender, k.seeks_gender
       FROM signal_closer_keys k JOIN profile_signals s ON s.id = k.signal_id
      WHERE s.participant_id = $1::uuid`, [ownerId]);
  return new Map(result.rows.map((row) => [String(row.signal_id), keysFromRow(row)]));
}

export async function countActiveCloserSignalsWithDatabase(database: SignalReader, ownerId: string): Promise<number> {
  const result = await database.query(
    `SELECT count(*)::integer AS count FROM profile_signals
      WHERE participant_id = $1::uuid AND kind = '${CLOSER_TYPE_KEY}' AND status = 'active'`, [ownerId]);
  return Number(result.rows[0]?.count ?? 0);
}

// The single definition of a match, shared by listing, notification and dialog creation.
// `mine`/`theirs` are profile_signals, `mk`/`tk` their keys, `mp`/`tp` their owners, `g` the goal.
const matchFrom = `
       FROM profile_signals mine
       JOIN signal_closer_keys mk ON mk.signal_id = mine.id
       JOIN participants mp ON mp.id = mine.participant_id
       JOIN closer_goals g ON g.key = mk.goal_key AND g.enabled
       JOIN signal_closer_keys tk ON tk.goal_key = mk.goal_key
       JOIN profile_signals theirs ON theirs.id = tk.signal_id
       JOIN participants tp ON tp.id = theirs.participant_id
      WHERE mine.kind = '${CLOSER_TYPE_KEY}' AND mine.status = 'active' AND mine.visibility = 'match_only'
        AND theirs.kind = '${CLOSER_TYPE_KEY}' AND theirs.status = 'active' AND theirs.visibility = 'match_only'
        AND theirs.participant_id <> mine.participant_id
        AND (mk.any_city OR tk.any_city OR (
              NULLIF(btrim(mp.residence_name), '') IS NOT NULL
              AND lower(btrim(mp.residence_name)) = lower(btrim(tp.residence_name))))
        AND (NOT g.asks_gender OR (
              (mk.seeks_gender = 'any' OR mk.seeks_gender = tk.self_gender)
              AND (tk.seeks_gender = 'any' OR tk.seeks_gender = mk.self_gender)))
        -- Once either side has cancelled a dialog, the pair is not offered to each other again.
        AND NOT EXISTS (
              SELECT 1 FROM relay_encounters x
               WHERE x.status = 'cancelled' AND x.signal_id IN (mine.id, theirs.id)
                 AND ((x.author_id = mine.participant_id AND x.responder_id = theirs.participant_id)
                   OR (x.author_id = theirs.participant_id AND x.responder_id = mine.participant_id)))`;
const openEncounter = `(SELECT e.id FROM relay_encounters e
                         WHERE e.status IN ('active', 'revealed') AND (
                               (e.signal_id = theirs.id AND e.responder_id = mine.participant_id)
                            OR (e.signal_id = mine.id AND e.responder_id = theirs.participant_id))
                         ORDER BY e.created_at LIMIT 1)`;

export async function listCloserMatchesWithDatabase(database: SignalReader, viewerId: string): Promise<CloserMatch[]> {
  const result = await database.query(
    `SELECT DISTINCT ON (theirs.created_at, theirs.id)
            mine.id AS my_signal_id, theirs.id AS signal_id, g.display_name AS goal_name,
            CASE WHEN tk.any_city THEN NULL ELSE tp.residence_name END AS city,
            theirs.label, theirs.description, ${openEncounter} AS encounter_id
     ${matchFrom}
        AND mine.participant_id = $1::uuid
      ORDER BY theirs.created_at DESC, theirs.id DESC, mine.id LIMIT 50`, [viewerId]);
  return result.rows.map((row) => ({
    mySignalId: String(row.my_signal_id), signalId: String(row.signal_id), goalName: String(row.goal_name),
    city: row.city == null ? null : String(row.city), label: String(row.label),
    description: row.description == null ? null : String(row.description),
    encounterId: row.encounter_id == null ? null : String(row.encounter_id),
  }));
}

// Internal: counterpart records of one signal with their owners, for notification only.
async function counterparts(client: SignalReader, signalId: string): Promise<Map<string, string>> {
  const result = await client.query(
    `SELECT theirs.id AS signal_id, theirs.participant_id AS owner_id ${matchFrom} AND mine.id = $1::uuid`, [signalId]);
  return new Map(result.rows.map((row) => [String(row.signal_id), String(row.owner_id)]));
}

async function transaction<T>(database: SignalDatabase, work: (client: SignalClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* Preserve the original error. */ }
    throw error;
  } finally { client.release(); }
}

// Counterpart record IDs of an own record. The caller snapshots them before an edit that may
// change visibility, so that only matches produced by the whole edit are announced.
export async function listCloserCounterpartIdsWithDatabase(database: SignalReader, ownerId: string, signalId: string): Promise<string[]> {
  const result = await database.query(
    `SELECT theirs.id AS signal_id ${matchFrom} AND mine.id = $1::uuid AND mine.participant_id = $2::uuid`, [signalId, ownerId]);
  return result.rows.map((row) => String(row.signal_id));
}

export async function getCloserCityWithDatabase(database: SignalReader, participantId: string): Promise<string | null> {
  const result = await database.query("SELECT residence_name FROM participants WHERE id = $1::uuid", [participantId]);
  return result.rows[0]?.residence_name == null ? null : String(result.rows[0].residence_name);
}

// Returns the owners for whom this save produced a match that did not exist before it.
export async function setCloserKeysWithDatabase(
  database: SignalDatabase, ownerId: string, signalId: string, keys: CloserKeys, matchedBefore?: string[],
): Promise<string[]> {
  return transaction(database, async (client) => {
    const own = await client.query(
      `SELECT id FROM profile_signals WHERE id = $1::uuid AND participant_id = $2::uuid
          AND kind = '${CLOSER_TYPE_KEY}' AND status = 'active' FOR UPDATE`, [signalId, ownerId]);
    if (!own.rowCount) throw new SignalValidationError("Signal unavailable");
    const goal = await client.query("SELECT key FROM closer_goals WHERE key = $1 AND enabled FOR SHARE", [keys.goalKey]);
    if (!goal.rowCount) throw new SignalValidationError("Unknown or disabled closer goal");
    const before = matchedBefore ? new Set(matchedBefore) : await counterparts(client, signalId);
    await client.query(
      `INSERT INTO signal_closer_keys(signal_id, goal_key, any_city, self_gender, seeks_gender)
       VALUES ($1::uuid, $2, $3, $4, $5)
       ON CONFLICT (signal_id) DO UPDATE SET goal_key = EXCLUDED.goal_key, any_city = EXCLUDED.any_city,
         self_gender = EXCLUDED.self_gender, seeks_gender = EXCLUDED.seeks_gender, updated_at = now()`,
      [signalId, keys.goalKey, keys.anyCity, keys.selfGender, keys.seeksGender]);
    const after = await counterparts(client, signalId);
    // Reference and goal only: neither the text nor the gender keys enter the shared audit log.
    await client.query(`INSERT INTO events(event_type, participant_id, payload) VALUES ($1, $2::uuid, $3::jsonb)`,
      ["participant.closer_keys_set", ownerId, JSON.stringify({ signal_id: signalId, goal_key: keys.goalKey })]);
    return [...new Set([...after].filter(([id]) => !before.has(id)).map(([, owner]) => owner))];
  });
}

// Either side of an existing match may open the anonymous dialog; Relay keeps both
// identities hidden until mutual consent. A second click returns the same dialog.
export async function openCloserDialogWithDatabase(
  database: SignalDatabase, viewerId: string, mySignalIdValue: unknown, signalIdValue: unknown,
): Promise<{ encounterId: string; notifyParticipantId: string | null }> {
  const mySignalId = requiredUuid(mySignalIdValue), signalId = requiredUuid(signalIdValue);
  return transaction(database, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`closer-pair:${[mySignalId, signalId].sort().join(":")}`]);
    const match = await client.query(
      `SELECT theirs.participant_id AS owner_id, ${openEncounter} AS encounter_id ${matchFrom}
          AND mine.id = $1::uuid AND mine.participant_id = $2::uuid AND theirs.id = $3::uuid`,
      [mySignalId, viewerId, signalId]);
    if (!match.rowCount) throw new CloserUnavailableError();
    if (match.rows[0].encounter_id) return { encounterId: String(match.rows[0].encounter_id), notifyParticipantId: null };
    const ownerId = String(match.rows[0].owner_id);
    const created = await client.query(
      `INSERT INTO relay_encounters(signal_id, author_id, responder_id) VALUES ($1::uuid, $2::uuid, $3::uuid) RETURNING id`,
      [signalId, ownerId, viewerId]);
    return { encounterId: String(created.rows[0].id), notifyParticipantId: ownerId };
  });
}

export type CloserGoalUpdate = { key: string; displayName: unknown; asksGender: boolean; enabled: boolean };
export type NewCloserGoal = { key: unknown; displayName: unknown; asksGender: boolean };

// Goals are never deleted: records keep their goal; a disabled goal stops matching and new use.
export async function saveCloserGoalsWithDatabase(
  database: SignalDatabase, actorId: string, updates: CloserGoalUpdate[], added?: NewCloserGoal,
): Promise<boolean> {
  const name = (value: unknown) => normalizeBoundedText(value, "Closer goal name", 60);
  const normalized = updates.map((goal) => ({ ...goal, displayName: name(goal.displayName) }));
  let fresh: { key: string; displayName: string; asksGender: boolean } | undefined;
  if (added) {
    if (typeof added.key !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(added.key)) throw new SignalValidationError("Invalid closer goal key");
    fresh = { key: added.key, displayName: name(added.displayName), asksGender: added.asksGender };
  }
  return transaction(database, async (client) => {
    await client.query("LOCK TABLE closer_goals IN SHARE ROW EXCLUSIVE MODE");
    const changed: string[] = [];
    for (const goal of normalized) {
      const result = await client.query(
        `UPDATE closer_goals SET display_name = $2, asks_gender = $3, enabled = $4
          WHERE key = $1 AND (display_name, asks_gender, enabled) IS DISTINCT FROM ($2, $3::boolean, $4::boolean) RETURNING key`,
        [goal.key, goal.displayName, goal.asksGender, goal.enabled]);
      if (result.rowCount) changed.push(goal.key);
    }
    if (fresh) {
      const result = await client.query(
        `INSERT INTO closer_goals(key, display_name, asks_gender, position)
         SELECT $1, $2, $3, COALESCE(max(position), 0) + 10 FROM closer_goals
         ON CONFLICT (key) DO NOTHING RETURNING key`, [fresh.key, fresh.displayName, fresh.asksGender]);
      if (!result.rowCount) throw new SignalValidationError("Closer goal key already exists");
      changed.push(fresh.key);
    }
    if (changed.length) await client.query(
      `INSERT INTO events(event_type, participant_id, payload) VALUES ('closer.goals_updated', $1::uuid, $2::jsonb)`,
      [actorId, JSON.stringify({ changed_by_participant_id: actorId, keys: changed })]);
    return changed.length > 0;
  });
}

export async function listCloserGoals() { const { pool } = await import("./db"); return listCloserGoalsWithDatabase(pool); }
export async function listOwnCloserKeys(ownerId: string) { const { pool } = await import("./db"); return listOwnCloserKeysWithDatabase(pool, ownerId); }
export async function countActiveCloserSignals(ownerId: string) { const { pool } = await import("./db"); return countActiveCloserSignalsWithDatabase(pool, ownerId); }
export async function listCloserMatches(viewerId: string) { const { pool } = await import("./db"); return listCloserMatchesWithDatabase(pool, viewerId); }
export async function setCloserKeys(ownerId: string, signalId: string, keys: CloserKeys, matchedBefore?: string[]) {
  const { pool } = await import("./db"); return setCloserKeysWithDatabase(pool, ownerId, signalId, keys, matchedBefore);
}
export async function listCloserCounterpartIds(ownerId: string, signalId: string) {
  const { pool } = await import("./db"); return listCloserCounterpartIdsWithDatabase(pool, ownerId, signalId);
}
export async function getCloserCity(participantId: string) { const { pool } = await import("./db"); return getCloserCityWithDatabase(pool, participantId); }
export async function openCloserDialog(viewerId: string, mySignalId: unknown, signalId: unknown) {
  const { pool } = await import("./db"); return openCloserDialogWithDatabase(pool, viewerId, mySignalId, signalId);
}
export async function saveCloserGoals(actorId: string, updates: CloserGoalUpdate[], added?: NewCloserGoal) {
  const { pool } = await import("./db"); return saveCloserGoalsWithDatabase(pool, actorId, updates, added);
}
