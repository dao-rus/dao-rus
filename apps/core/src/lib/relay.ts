import { pool } from "./db";
import type { ProfileSignalKind } from "./profile-about";

type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
export type RelayDatabase = { query(text: string, values?: unknown[]): Promise<QueryResult> };
export type ExchangeSignal = {
  id: string; kind: ProfileSignalKind; body: string; mine: boolean; anonymous: boolean;
  author: { id: string; name: string } | null;
};
export type RelayEncounter = {
  id: string;
  kind: "need" | "have";
  body: string;
  status: "active" | "revealed" | "cancelled";
  role: "author" | "responder";
  myConsent: boolean;
  other: { id: string; name: string; username: string | null } | null;
};
export type RelayMessage = { id: string; body: string; mine: boolean };

export class RelayAccessError extends Error {
  constructor() { super("Relay interaction is unavailable"); this.name = "RelayAccessError"; }
}
export class RelayValidationError extends Error {
  constructor() { super("Invalid relay input"); this.name = "RelayValidationError"; }
}

function requiredUuid(value: unknown): string {
  if (typeof value !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new RelayValidationError();
  }
  return value;
}

function encounterFromRow(row: Record<string, unknown>): RelayEncounter {
  const status = String(row.status) as RelayEncounter["status"];
  return {
    id: String(row.id),
    kind: String(row.kind) as RelayEncounter["kind"],
    body: String(row.body),
    status,
    role: String(row.role) as RelayEncounter["role"],
    myConsent: Boolean(row.my_consent),
    other: status === "revealed" && row.other_id
      ? { id: String(row.other_id), name: String(row.other_name),
          username: row.other_username ? String(row.other_username) : null }
      : null,
  };
}

export async function listExchangeSignalsWithDatabase(
  database: RelayDatabase, viewerId: string, kind: ProfileSignalKind,
): Promise<ExchangeSignal[]> {
  const result = await database.query(
    `SELECT s.id, s.kind, s.body, (s.participant_id = $1::uuid) AS mine,
            (s.visibility = 'network_blind') AS anonymous,
            CASE WHEN s.visibility <> 'network_blind' THEN author.id END AS author_id,
            CASE WHEN s.visibility <> 'network_blind' THEN author.display_name END AS author_name
       FROM profile_signals s
       JOIN participants author ON author.id = s.participant_id
      WHERE s.status = 'active'
        AND s.kind = $2
        AND s.visibility IN ('public', 'members', 'network_blind')
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 100`,
    [viewerId, kind],
  );
  return result.rows.map((row) => ({
    id: String(row.id), kind: String(row.kind) as ProfileSignalKind,
    body: String(row.body), mine: Boolean(row.mine), anonymous: Boolean(row.anonymous),
    author: row.anonymous || !row.author_id ? null
      : { id: String(row.author_id), name: String(row.author_name) },
  }));
}

export async function createRelayEncounterWithDatabase(
  database: RelayDatabase, responderId: string, signalIdValue: unknown,
): Promise<string> {
  const signalId = requiredUuid(signalIdValue);
  const result = await database.query(
    `INSERT INTO relay_encounters(signal_id, author_id, responder_id)
     SELECT s.id, s.participant_id, $2::uuid
       FROM profile_signals s
      WHERE s.id = $1::uuid
        AND s.visibility = 'network_blind'
        AND s.status = 'active'
        AND s.kind IN ('need', 'have')
        AND s.participant_id <> $2::uuid
      FOR UPDATE OF s
      RETURNING id`,
    [signalId, responderId],
  );
  if (!result.rowCount) throw new RelayAccessError();
  return String(result.rows[0].id);
}

const encounterSelect = `SELECT e.id, e.status, s.kind, s.body,
       CASE WHEN e.author_id = $2::uuid THEN 'author' ELSE 'responder' END AS role,
       CASE WHEN e.author_id = $2::uuid
            THEN e.author_consented_at IS NOT NULL
            ELSE e.responder_consented_at IS NOT NULL END AS my_consent,
       CASE WHEN e.status = 'revealed' THEN other.id END AS other_id,
       CASE WHEN e.status = 'revealed' THEN other.display_name END AS other_name,
       CASE WHEN e.status = 'revealed' THEN identity.username END AS other_username
  FROM relay_encounters e
  JOIN profile_signals s ON s.id = e.signal_id
  JOIN participants other
    ON other.id = CASE WHEN e.author_id = $2::uuid THEN e.responder_id ELSE e.author_id END
  LEFT JOIN external_identities identity
    ON identity.participant_id = other.id AND identity.provider = 'telegram'
 WHERE (e.author_id = $2::uuid OR e.responder_id = $2::uuid)`;

export async function listRelayEncountersWithDatabase(
  database: RelayDatabase, viewerId: string, archive: boolean,
): Promise<RelayEncounter[]> {
  const result = await database.query(
    encounterSelect + `
       AND (CASE WHEN $1::boolean THEN e.status = 'cancelled'
                 ELSE e.status IN ('active', 'revealed') END)
     ORDER BY e.created_at DESC, e.id DESC LIMIT 100`,
    [archive, viewerId],
  );
  return result.rows.map(encounterFromRow);
}

export async function getRelayEncounterWithDatabase(
  database: RelayDatabase, viewerId: string, encounterIdValue: unknown,
): Promise<RelayEncounter | null> {
  const encounterId = requiredUuid(encounterIdValue);
  const result = await database.query(
    encounterSelect + ` AND e.id = $1::uuid`,
    [encounterId, viewerId],
  );
  return result.rowCount ? encounterFromRow(result.rows[0]) : null;
}

export async function listRelayMessagesWithDatabase(
  database: RelayDatabase, viewerId: string, encounterIdValue: unknown,
): Promise<RelayMessage[]> {
  const encounterId = requiredUuid(encounterIdValue);
  const result = await database.query(
    `SELECT m.id, m.body, (m.sender_id = $2::uuid) AS mine
       FROM relay_messages m
       JOIN relay_encounters e ON e.id = m.encounter_id
      WHERE e.id = $1::uuid
        AND (e.author_id = $2::uuid OR e.responder_id = $2::uuid)
      ORDER BY m.created_at, m.id LIMIT 500`,
    [encounterId, viewerId],
  );
  return result.rows.map((row) => ({
    id: String(row.id), body: String(row.body), mine: Boolean(row.mine),
  }));
}

export async function sendRelayMessageWithDatabase(
  database: RelayDatabase, viewerId: string, encounterIdValue: unknown, bodyValue: unknown,
): Promise<void> {
  const encounterId = requiredUuid(encounterIdValue);
  if (typeof bodyValue !== "string" || !bodyValue.trim() || bodyValue.trim().length > 2000) {
    throw new RelayValidationError();
  }
  const result = await database.query(
    `INSERT INTO relay_messages(encounter_id, sender_id, body)
     SELECT e.id, $2::uuid, $3
       FROM relay_encounters e
      WHERE e.id = $1::uuid
        AND (e.author_id = $2::uuid OR e.responder_id = $2::uuid)
        AND e.status IN ('active', 'revealed')
      FOR UPDATE OF e
      RETURNING id`,
    [encounterId, viewerId, bodyValue.trim()],
  );
  if (!result.rowCount) throw new RelayAccessError();
}

export async function consentRelayRevealWithDatabase(
  database: RelayDatabase, viewerId: string, encounterIdValue: unknown,
): Promise<void> {
  const encounterId = requiredUuid(encounterIdValue);
  const result = await database.query(
    `UPDATE relay_encounters e
        SET author_consented_at = CASE WHEN e.author_id = $2::uuid
                                       THEN COALESCE(e.author_consented_at, now())
                                       ELSE e.author_consented_at END,
            responder_consented_at = CASE WHEN e.responder_id = $2::uuid
                                          THEN COALESCE(e.responder_consented_at, now())
                                          ELSE e.responder_consented_at END,
            status = CASE
                       WHEN (e.author_id = $2::uuid AND e.responder_consented_at IS NOT NULL)
                         OR (e.responder_id = $2::uuid AND e.author_consented_at IS NOT NULL)
                       THEN 'revealed' ELSE e.status END,
            updated_at = now()
      WHERE e.id = $1::uuid
        AND e.status = 'active'
        AND (e.author_id = $2::uuid OR e.responder_id = $2::uuid)
      RETURNING id`,
    [encounterId, viewerId],
  );
  if (!result.rowCount) throw new RelayAccessError();
}

export async function cancelRelayEncounterWithDatabase(
  database: RelayDatabase, viewerId: string, encounterIdValue: unknown,
): Promise<void> {
  const encounterId = requiredUuid(encounterIdValue);
  const result = await database.query(
    `UPDATE relay_encounters e
        SET status = 'cancelled', updated_at = now()
      WHERE e.id = $1::uuid
        AND e.status IN ('active', 'revealed')
        AND (e.author_id = $2::uuid OR e.responder_id = $2::uuid)
      RETURNING id`,
    [encounterId, viewerId],
  );
  if (!result.rowCount) throw new RelayAccessError();
}

export const listExchangeSignals = (viewerId: string, kind: ProfileSignalKind) =>
  listExchangeSignalsWithDatabase(pool, viewerId, kind);
export const createRelayEncounter = (responderId: string, signalId: unknown) =>
  createRelayEncounterWithDatabase(pool, responderId, signalId);
export const listRelayEncounters = (viewerId: string, archive: boolean) =>
  listRelayEncountersWithDatabase(pool, viewerId, archive);
export const getRelayEncounter = (viewerId: string, encounterId: unknown) =>
  getRelayEncounterWithDatabase(pool, viewerId, encounterId);
export const listRelayMessages = (viewerId: string, encounterId: unknown) =>
  listRelayMessagesWithDatabase(pool, viewerId, encounterId);
export const sendRelayMessage = (viewerId: string, encounterId: unknown, body: unknown) =>
  sendRelayMessageWithDatabase(pool, viewerId, encounterId, body);
export const consentRelayReveal = (viewerId: string, encounterId: unknown) =>
  consentRelayRevealWithDatabase(pool, viewerId, encounterId);
export const cancelRelayEncounter = (viewerId: string, encounterId: unknown) =>
  cancelRelayEncounterWithDatabase(pool, viewerId, encounterId);
