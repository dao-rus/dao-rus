import { ProfileAboutValidationError as SignalValidationError, normalizeBoundedText } from "./profile-validation";
import { getOnboardingActionReward, type OnboardingReward } from "./onboarding-quests";

export { SignalValidationError };
export const PROFILE_VISIBILITIES = ["public", "members", "circle", "match_only", "private"] as const;
export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];
export type SignalVisibility = ProfileVisibility | "network_blind";
export type SignalTypeKey = string;
export type SignalType = { key: SignalTypeKey; displayName: string; enabled: boolean };
export type SignalStatus = "active" | "closed" | "archived";

// Viewer-safe domain representation. Network-blind listings always redact ownerId.
export type Signal = {
  id: string;
  ownerId: string | null;
  typeKey: SignalTypeKey;
  label: string;
  description: string | null;
  visibility: SignalVisibility;
  status: SignalStatus;
  legacyBody: boolean;
  createdAt: Date;
  updatedAt: Date;
};
export type NetworkSignal = Signal & {
  mine: boolean;
  author: { id: string; name: string } | null;
};

type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
export type SignalReader = { query(text: string, values?: unknown[]): Promise<QueryResult> };
export type SignalClient = SignalReader & { release(): void };
export type SignalDatabase = SignalReader & { connect(): Promise<SignalClient> };
export type CreateSignalInput = {
  typeKey: unknown; label: unknown; description?: unknown; visibility: unknown;
};
export type SignalCreation = { signal: Signal; reward?: OnboardingReward };

export function normalizeSignalTypeKey(value: unknown): SignalTypeKey {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value)) {
    throw new SignalValidationError("Invalid signal kind");
  }
  return value;
}
export function normalizeSignalLabel(value: unknown): string {
  return normalizeBoundedText(value, "Signal label", 120);
}
export function normalizeSignalDescription(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new SignalValidationError("Signal description must be text");
  return value.trim() ? normalizeBoundedText(value, "Signal description", 10000) : null;
}
export function normalizeProfileVisibility(value: unknown): ProfileVisibility {
  if (typeof value !== "string" || !PROFILE_VISIBILITIES.includes(value as ProfileVisibility)) {
    throw new SignalValidationError("Invalid visibility");
  }
  return value as ProfileVisibility;
}
export function normalizeSignalVisibility(value: unknown, typeKey: SignalTypeKey): SignalVisibility {
  if (value === "network_blind" && (typeKey === "need" || typeKey === "have")) return value;
  return normalizeProfileVisibility(value);
}

function signalTypeFromRow(row: Record<string, unknown>): SignalType {
  return { key: String(row.key), displayName: String(row.display_name), enabled: Boolean(row.enabled) };
}
export async function listSignalTypesWithDatabase(database: SignalReader): Promise<SignalType[]> {
  const result = await database.query("SELECT key, display_name, enabled FROM signal_types ORDER BY key");
  return result.rows.map(signalTypeFromRow);
}
export async function requireEnabledSignalTypeWithDatabase(
  database: SignalReader, typeKeyValue: unknown, lock = false,
): Promise<SignalType> {
  const typeKey = normalizeSignalTypeKey(typeKeyValue);
  const result = await database.query(
    "SELECT key, display_name, enabled FROM signal_types WHERE key = $1 AND enabled = true" + (lock ? " FOR SHARE" : ""),
    [typeKey],
  );
  if (!result.rowCount) throw new SignalValidationError("Unknown or disabled signal type");
  return signalTypeFromRow(result.rows[0]);
}

// Both read scopes and INSERT RETURNING share these canonical columns, never body.
const contentColumns = `s.id, s.kind, s.label, s.description, s.visibility, s.status,
                       s.legacy_body, s.created_at, s.updated_at`;
function signalFromRow(row: Record<string, unknown>, hideBlindOwner = false): Signal {
  return {
    id: String(row.id),
    ownerId: hideBlindOwner && row.visibility === "network_blind" ? null
      : row.owner_id == null ? null : String(row.owner_id),
    typeKey: String(row.kind), label: String(row.label),
    description: row.description == null ? null : String(row.description),
    visibility: String(row.visibility) as SignalVisibility,
    status: String(row.status) as SignalStatus,
    legacyBody: Boolean(row.legacy_body),
    createdAt: new Date(row.created_at as string | Date),
    updatedAt: new Date(row.updated_at as string | Date),
  };
}

// Existing A2 read scopes: profile identity excludes blind signals, the network masks it.
function visibleActiveSignalSql(scope: "profile" | "network"): string {
  const visibilities = scope === "profile" ? "'public', 'members'" : "'public', 'members', 'network_blind'";
  return `s.status = 'active' AND s.visibility IN (${visibilities})`;
}
const networkIdentityColumns = `(s.participant_id = $1::uuid) AS mine,
            CASE WHEN s.visibility <> 'network_blind' THEN s.participant_id END AS owner_id,
            CASE WHEN s.visibility <> 'network_blind' THEN author.id END AS author_id,
            CASE WHEN s.visibility <> 'network_blind' THEN author.display_name END AS author_name`;
function networkSignalFromRow(row: Record<string, unknown>): NetworkSignal {
  return {
    ...signalFromRow(row, true), mine: Boolean(row.mine),
    author: row.visibility === "network_blind" || !row.author_id ? null
      : { id: String(row.author_id), name: String(row.author_name) },
  };
}

export async function listParticipantSignalsWithDatabase(
  database: SignalReader, ownerId: string, viewerId: string, status: SignalStatus = "active",
): Promise<Signal[]> {
  if (!["active", "closed", "archived"].includes(status)) throw new SignalValidationError("Invalid signal status");
  // Inactive records are only available to their author, never added to public profiles.
  if (status !== "active" && ownerId !== viewerId) return [];
  const own = ownerId === viewerId;
  const result = await database.query(
    `SELECT ${contentColumns}, s.participant_id AS owner_id
       FROM profile_signals s
      WHERE s.participant_id = $1::uuid AND s.status = $2
        ${own ? "" : `AND ${visibleActiveSignalSql("profile")}`}
      ORDER BY s.created_at DESC, s.id DESC`,
    [ownerId, status],
  );
  return result.rows.map((row) => signalFromRow(row, !own));
}

export async function listNetworkSignalsWithDatabase(
  database: SignalReader, viewerId: string, typeKeyValue: unknown,
): Promise<NetworkSignal[]> {
  const typeKey = normalizeSignalTypeKey(typeKeyValue);
  const result = await database.query(
    `SELECT ${contentColumns}, ${networkIdentityColumns}
       FROM profile_signals s
       JOIN participants author ON author.id = s.participant_id
      WHERE ${visibleActiveSignalSql("network")} AND s.kind = $2
      ORDER BY s.created_at DESC, s.id DESC LIMIT 100`,
    [viewerId, typeKey],
  );
  return result.rows.map(networkSignalFromRow);
}

export type NetworkSignalSearch = { typeKeys: string[]; terms: string[] };

// This is deliberately a small, explainable PostgreSQL search. It starts from the
// same network visibility predicate as browse, so search cannot become a direct-URL
// or AI-assisted bypass for private, closed, circle, or match-only Signals.
export async function searchNetworkSignalsWithDatabase(
  database: SignalReader, viewerId: string, search: NetworkSignalSearch,
): Promise<NetworkSignal[]> {
  const typeKeys = search.typeKeys.map(normalizeSignalTypeKey);
  const terms = search.terms.map((term) => normalizeBoundedText(term, "Search term", 120).replace(/[!%_]/g, "!$&"));
  const result = await database.query(
    `SELECT ${contentColumns}, ${networkIdentityColumns}
       FROM profile_signals s
       JOIN participants author ON author.id = s.participant_id
      WHERE ${visibleActiveSignalSql("network")}
        AND (cardinality($2::text[]) = 0 OR s.kind = ANY($2::text[]))
        AND (cardinality($3::text[]) = 0 OR NOT EXISTS (
          SELECT 1 FROM unnest($3::text[]) AS term
           WHERE s.label NOT ILIKE '%' || term || '%' ESCAPE '!'
             AND COALESCE(s.description, '') NOT ILIKE '%' || term || '%' ESCAPE '!'
        ))
      ORDER BY s.created_at DESC, s.id DESC LIMIT 100`,
    [viewerId, typeKeys, terms],
  );
  return result.rows.map(networkSignalFromRow);
}

// Same viewer permissions as network browsing plus the owner's existing profile access.
// Unavailable and nonexistent IDs have the same null result; no unfiltered lookup is exposed.
export async function getSignalWithDatabase(
  database: SignalReader, viewerId: string, signalId: unknown,
): Promise<NetworkSignal | null> {
  if (typeof signalId !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(signalId)) return null;
  const result = await database.query(
    `SELECT ${contentColumns}, ${networkIdentityColumns}
       FROM profile_signals s
       JOIN participants author ON author.id = s.participant_id
      WHERE s.id = $2::uuid
        AND (s.participant_id = $1::uuid OR (${visibleActiveSignalSql("network")}))`,
    [viewerId, signalId],
  );
  return result.rowCount ? networkSignalFromRow(result.rows[0]) : null;
}

// `public` means readable without sign-in; the deprecated external_share_enabled column is ignored.
export type GuestSignal = Pick<Signal, "id" | "typeKey" | "label" | "description"> & { authorName: string };

export async function getGuestShareableSignalWithDatabase(database: SignalReader, signalId: unknown): Promise<GuestSignal | null> {
  if (typeof signalId !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(signalId)) return null;
  const result = await database.query(
    `SELECT s.id, s.kind, s.label, s.description, author.display_name AS author_name
       FROM profile_signals s
       JOIN participants author ON author.id = s.participant_id
      WHERE s.id = $1::uuid AND s.status = 'active' AND s.visibility = 'public'`,
    [signalId],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { id: String(row.id), typeKey: String(row.kind), label: String(row.label),
    description: row.description == null ? null : String(row.description), authorName: String(row.author_name) };
}

export async function getGuestShareableSignal(signalId: unknown) {
  const { pool } = await import("./db");
  return getGuestShareableSignalWithDatabase(pool, signalId);
}

export async function getSignal(viewerId: string, signalId: unknown) {
  const { pool } = await import("./db");
  return getSignalWithDatabase(pool, viewerId, signalId);
}

async function withSignalTransaction<T>(database: SignalDatabase, work: (client: SignalClient) => Promise<T>): Promise<T> {
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

export async function createSignalWithDatabase(
  database: SignalDatabase, ownerId: string, input: CreateSignalInput,
): Promise<SignalCreation> {
  const typeKey = normalizeSignalTypeKey(input.typeKey);
  const label = normalizeSignalLabel(input.label);
  const description = normalizeSignalDescription(input.description);
  const visibility = normalizeSignalVisibility(input.visibility, typeKey);
  return insertSignal(database, ownerId, typeKey, visibility, { label, description });
}

// Internal compatibility entry point: body is legacy input, never universal content.
// Called only by the legacy adapter; A1 SQL also enforces its four-type boundary.
export async function createLegacySignalWithDatabase(
  database: SignalDatabase, ownerId: string, typeKey: SignalTypeKey, body: string, visibility: SignalVisibility,
): Promise<SignalCreation> {
  return insertSignal(database, ownerId, typeKey, visibility, { body });
}

async function insertSignal(
  database: SignalDatabase, ownerId: string, typeKey: SignalTypeKey, visibility: SignalVisibility,
  content: { label: string; description: string | null } | { body: string },
): Promise<SignalCreation> {
  return withSignalTransaction(database, async (client) => {
    await requireEnabledSignalTypeWithDatabase(client, typeKey, true);
    const returning = `RETURNING ${contentColumns}, s.participant_id AS owner_id`;
    const result = "body" in content
      ? await client.query(
          `INSERT INTO profile_signals AS s(participant_id, kind, body, visibility)
           VALUES ($1::uuid, $2, $3, $4) ${returning}`, [ownerId, typeKey, content.body, visibility],
        )
      : await client.query(
          `INSERT INTO profile_signals AS s(participant_id, kind, label, description, visibility)
           VALUES ($1::uuid, $2, $3, $4, $5) ${returning}`, [ownerId, typeKey, content.label, content.description, visibility],
        );
    const signal = signalFromRow(result.rows[0]);
    // Additive metadata, with a canonical-record reference instead of private text in the audit log.
    await client.query(`INSERT INTO events(event_type, participant_id, payload) VALUES ($1, $2::uuid, $3::jsonb)`,
      ["participant.signal_created", ownerId, JSON.stringify({
        signal_id: signal.id, kind: signal.typeKey, visibility: signal.visibility,
        type_key: signal.typeKey, status: signal.status, legacy_body: signal.legacyBody,
        content_source: "label_description",
      })]);
    const reward = typeKey === "need" || typeKey === "have"
      ? await getOnboardingActionReward(client, ownerId, `${typeKey}_first_created`) : undefined;
    return reward ? { signal, reward } : { signal };
  });
}

export async function archiveSignalWithDatabase(database: SignalDatabase, ownerId: string, signalId: string): Promise<void> {
  await withSignalTransaction(database, async (client) => {
    const result = await client.query(
      `UPDATE profile_signals SET status = 'archived', updated_at = now()
        WHERE id = $1::uuid AND participant_id = $2::uuid AND status = 'active' RETURNING id`,
      [signalId, ownerId],
    );
    if (result.rowCount) await client.query(
      `INSERT INTO events(event_type, participant_id, payload) VALUES ($1, $2::uuid, $3::jsonb)`,
      ["participant.signal_archived", ownerId, JSON.stringify({ signal_id: signalId })],
    );
  });
}

export async function updateSignalWithDatabase(
  database: SignalDatabase, ownerId: string, signalId: string,
  input: Omit<CreateSignalInput, "typeKey">,
): Promise<Signal> {
  const label = normalizeSignalLabel(input.label);
  const description = normalizeSignalDescription(input.description);
  return withSignalTransaction(database, async (client) => {
    const previous = await client.query(
      `SELECT kind FROM profile_signals WHERE id = $1::uuid
        AND participant_id = $2::uuid AND status = 'active' FOR UPDATE`, [signalId, ownerId],
    );
    if (!previous.rowCount) throw new SignalValidationError("Signal unavailable");
    const visibility = normalizeSignalVisibility(input.visibility, String(previous.rows[0].kind));
    const result = await client.query(
      `UPDATE profile_signals AS s SET label = $3, description = $4, visibility = $5,
              legacy_body = false, updated_at = now()
        WHERE s.id = $1::uuid AND s.participant_id = $2::uuid AND s.status = 'active'
        RETURNING ${contentColumns}, s.participant_id AS owner_id`,
      [signalId, ownerId, label, description, visibility],
    );
    const signal = signalFromRow(result.rows[0]);
    await client.query(`INSERT INTO events(event_type, participant_id, payload) VALUES ($1, $2::uuid, $3::jsonb)`,
      ["participant.signal_updated", ownerId, JSON.stringify({ signal_id: signal.id,
        type_key: signal.typeKey, visibility: signal.visibility, content_source: "label_description" })]);
    return signal;
  });
}

export async function updateSignal(ownerId: string, signalId: string, input: Omit<CreateSignalInput, "typeKey">) {
  const { pool } = await import("./db");
  return updateSignalWithDatabase(pool, ownerId, signalId, input);
}

export async function createSignal(ownerId: string, input: CreateSignalInput) {
  const { pool } = await import("./db");
  return createSignalWithDatabase(pool, ownerId, input);
}
export async function listParticipantSignals(ownerId: string, viewerId: string, status?: SignalStatus) {
  const { pool } = await import("./db");
  return listParticipantSignalsWithDatabase(pool, ownerId, viewerId, status);
}
export async function listNetworkSignals(viewerId: string, typeKey: unknown) {
  const { pool } = await import("./db");
  return listNetworkSignalsWithDatabase(pool, viewerId, typeKey);
}
export async function searchNetworkSignals(viewerId: string, search: NetworkSignalSearch) {
  const { pool } = await import("./db");
  return searchNetworkSignalsWithDatabase(pool, viewerId, search);
}
export async function listSignalTypes() {
  const { pool } = await import("./db");
  return listSignalTypesWithDatabase(pool);
}
export async function requireEnabledSignalType(typeKey: unknown) {
  const { pool } = await import("./db");
  return requireEnabledSignalTypeWithDatabase(pool, typeKey);
}
