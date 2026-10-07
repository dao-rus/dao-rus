import { AwardAccessError, requireAwardCapability } from "./award-access";

export { AwardAccessError } from "./award-access";
export type AwardKind = "historical" | "open";
export type AwardInstanceStatus = "offered" | "declined" | "accepted" | "rejected";
export type AwardInstanceAction = "decline" | "accept" | "reject";
export const AWARD_CHARTER_VERSION = 1;

export type Award = {
  id: string; slug: string; name: string; imageUrl: string; establishedOn: string;
  description: string; criterion: string; publicAddress: string; kind: AwardKind;
  historicalCutoffAt: Date | null; founderParticipantId: string; charterVersion: number; createdAt: Date;
};
export type AwardInstance = {
  id: string; awardId: string; participantId: string; awardedByParticipantId: string;
  reason: string; personalAddress: string; status: AwardInstanceStatus;
  offeredAt: Date; declinedAt: Date | null; acceptedAt: Date | null; rejectedAt: Date | null;
  showInPublicList: boolean; showNextToName: boolean;
};
export type EstablishAwardInput = {
  slug: unknown; name: unknown; imageUrl: unknown; establishedOn: unknown;
  description: unknown; criterion: unknown; publicAddress: unknown; kind: unknown;
  historicalCutoffAt?: unknown;
};
export type OfferAwardInput = { awardId: string; participantId: string; reason: unknown; personalAddress?: unknown };
type QueryResult = { rowCount: number | null; rows: Array<Record<string, unknown>> };
export type AwardReader = { query(text: string, values?: unknown[]): Promise<QueryResult> };
export type AwardDatabaseClient = AwardReader & { release(): void };
export type AwardDatabase = AwardReader & { connect(): Promise<AwardDatabaseClient> };

export class AwardValidationError extends Error {
  constructor(message: string) { super(message); this.name = "AwardValidationError"; }
}
export class AwardNotFoundError extends Error {
  constructor(message = "Award or instance not found") { super(message); this.name = "AwardNotFoundError"; }
}
export class AwardConflictError extends Error {
  constructor(message: string) { super(message); this.name = "AwardConflictError"; }
}
export class AwardTransitionError extends Error {
  constructor(message: string) { super(message); this.name = "AwardTransitionError"; }
}

const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function id(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new AwardValidationError("Invalid Participant/Award UUID");
  return value.toLowerCase();
}
function text(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== "string") throw new AwardValidationError(`${field} must be text`);
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || normalized.length > max) throw new AwardValidationError(`Invalid ${field}`);
  return normalized;
}
function imageUrl(value: unknown): string {
  const url = text(value, "image URL", 2048);
  if (/[\s\\\u0000-\u001f]/u.test(url)) throw new AwardValidationError("Invalid image URL");
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return url;
  } catch { /* Invalid URL. */ }
  throw new AwardValidationError("Use a local path or HTTPS image URL");
}
function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AwardValidationError("Invalid establishment date");
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new AwardValidationError("Invalid establishment date");
  return value;
}
function cutoff(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  // Require an explicit timezone; historical eligibility must not depend on the host timezone.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new AwardValidationError("Invalid historical cutoff timestamp");
  }
  calendarDate(value.slice(0, 10));
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AwardValidationError("Invalid historical cutoff timestamp");
  return date;
}
const optionalDate = (value: unknown) => value == null ? null : new Date(value as string | Date);
function awardFromRow(row: Record<string, unknown>): Award {
  return {
    id: String(row.id), slug: String(row.slug), name: String(row.name), imageUrl: String(row.image_url),
    establishedOn: String(row.established_on), description: String(row.description), criterion: String(row.criterion),
    publicAddress: String(row.public_address), kind: row.kind as AwardKind,
    historicalCutoffAt: optionalDate(row.historical_cutoff_at), founderParticipantId: String(row.founder_participant_id),
    charterVersion: Number(row.charter_version), createdAt: new Date(row.created_at as string | Date),
  };
}
function instanceFromRow(row: Record<string, unknown>): AwardInstance {
  return {
    id: String(row.id), awardId: String(row.award_id), participantId: String(row.participant_id),
    awardedByParticipantId: String(row.awarded_by_participant_id), reason: String(row.reason),
    personalAddress: String(row.personal_address), status: row.status as AwardInstanceStatus,
    offeredAt: new Date(row.offered_at as string | Date), declinedAt: optionalDate(row.declined_at),
    acceptedAt: optionalDate(row.accepted_at), rejectedAt: optionalDate(row.rejected_at),
    showInPublicList: row.show_in_public_list === true, showNextToName: row.show_next_to_name === true,
  };
}

export function awardInstancePublicity(instance: Pick<AwardInstance, "status" | "showInPublicList" | "showNextToName">) {
  return {
    inPublicList: instance.status === "accepted" && instance.showInPublicList,
    nextToName: instance.status === "accepted" && instance.showNextToName,
  };
}

async function transaction<T>(database: AwardDatabase, work: (client: AwardDatabaseClient) => Promise<T>): Promise<T> {
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
async function requireParticipant(client: AwardReader, participantId: string) {
  const result = await client.query("SELECT id FROM participants WHERE id = $1::uuid", [participantId]);
  if (!result.rowCount) throw new AwardNotFoundError("Participant not found");
}

export async function establishAwardWithDatabase(database: AwardDatabase, actorId: string, input: EstablishAwardInput): Promise<Award> {
  const actor = id(actorId);
  requireAwardCapability(actor, "award.establish");
  const slug = text(input.slug, "slug", 100);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new AwardValidationError("Invalid award slug");
  if (input.kind !== "historical" && input.kind !== "open") throw new AwardValidationError("Invalid award kind");
  const historicalCutoffAt = cutoff(input.historicalCutoffAt);
  if (input.kind === "open" && historicalCutoffAt) throw new AwardValidationError("An open award has no historical cutoff");
  const values = [slug, text(input.name, "name", 200), imageUrl(input.imageUrl), calendarDate(input.establishedOn),
    text(input.description, "description", 10000), text(input.criterion, "criterion", 10000),
    text(input.publicAddress, "public address", 10000), input.kind, historicalCutoffAt, actor, AWARD_CHARTER_VERSION];
  return transaction(database, async client => {
    await requireParticipant(client, actor);
    const result = await client.query(
      `INSERT INTO awards(slug, name, image_url, established_on, description, criterion, public_address,
         kind, historical_cutoff_at, founder_participant_id, charter_version)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10::uuid, $11)
       ON CONFLICT (slug) DO NOTHING RETURNING *, established_on::text AS established_on`, values);
    if (!result.rowCount) throw new AwardConflictError("Award slug already exists");
    return awardFromRow(result.rows[0]);
  });
}

export async function offerAwardWithDatabase(database: AwardDatabase, actorId: string, input: OfferAwardInput) {
  const actor = id(actorId);
  requireAwardCapability(actor, "award.offer");
  const awardId = id(input.awardId), participantId = id(input.participantId);
  const reason = text(input.reason, "reason", 2000), personalAddress = text(input.personalAddress ?? "", "personal address", 10000, true);
  return transaction(database, async client => {
    await requireParticipant(client, actor);
    await requireParticipant(client, participantId);
    const award = await client.query("SELECT id FROM awards WHERE id = $1::uuid", [awardId]);
    if (!award.rowCount) throw new AwardNotFoundError();
    const result = await client.query(
      `INSERT INTO award_instances(award_id, participant_id, awarded_by_participant_id, reason, personal_address)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
       ON CONFLICT (award_id, participant_id) DO NOTHING RETURNING *`,
      [awardId, participantId, actor, reason, personalAddress]);
    if (result.rowCount) return { instance: instanceFromRow(result.rows[0]), created: true };
    // A retry returns the same permanent instance; changed content is a new award attempt and is denied.
    const existing = await client.query("SELECT * FROM award_instances WHERE award_id = $1::uuid AND participant_id = $2::uuid", [awardId, participantId]);
    const instance = instanceFromRow(existing.rows[0]);
    if (instance.awardedByParticipantId !== actor || instance.reason !== reason || instance.personalAddress !== personalAddress) {
      throw new AwardConflictError("This Participant already has an instance of this award");
    }
    return { instance, created: false };
  });
}

export async function actOnAwardInstanceWithDatabase(
  database: AwardDatabase, actorId: string, instanceId: string, action: AwardInstanceAction,
) {
  const actor = id(actorId), instance = id(instanceId);
  if (action !== "accept" && action !== "decline" && action !== "reject") throw new AwardValidationError("Invalid award action");
  return transaction(database, async client => {
    const result = await client.query("SELECT * FROM award_instances WHERE id = $1::uuid FOR UPDATE", [instance]);
    if (!result.rowCount) throw new AwardNotFoundError();
    const current = instanceFromRow(result.rows[0]);
    if (current.participantId !== actor) throw new AwardAccessError("Only the recipient may act on an award instance");
    const target = ({ accept: "accepted", decline: "declined", reject: "rejected" } as const)[action];
    if (current.status === target) return { instance: current, changed: false };
    const allowed = action === "accept" ? current.status === "offered" || current.status === "declined"
      : action === "decline" ? current.status === "offered" : current.status === "accepted";
    if (!allowed) throw new AwardTransitionError(`Cannot ${action} an award in state ${current.status}`);
    const updated = await client.query("UPDATE award_instances SET status = $2 WHERE id = $1::uuid RETURNING *", [instance, target]);
    return { instance: instanceFromRow(updated.rows[0]), changed: true };
  });
}

export async function setAwardVisibilityWithDatabase(
  database: AwardDatabase, actorId: string, instanceId: string,
  visibility: { showInPublicList: boolean; showNextToName: boolean },
) {
  const actor = id(actorId), instance = id(instanceId);
  if (typeof visibility.showInPublicList !== "boolean" || typeof visibility.showNextToName !== "boolean") {
    throw new AwardValidationError("Award visibility flags must be boolean");
  }
  return transaction(database, async client => {
    const result = await client.query("SELECT * FROM award_instances WHERE id = $1::uuid FOR UPDATE", [instance]);
    if (!result.rowCount) throw new AwardNotFoundError();
    const current = instanceFromRow(result.rows[0]);
    if (current.participantId !== actor) throw new AwardAccessError("Only the recipient may change award visibility");
    if (current.status !== "accepted") throw new AwardTransitionError("Visibility can change only while accepted");
    if (current.showInPublicList === visibility.showInPublicList && current.showNextToName === visibility.showNextToName) {
      return { instance: current, changed: false };
    }
    const updated = await client.query(
      "UPDATE award_instances SET show_in_public_list = $2, show_next_to_name = $3 WHERE id = $1::uuid RETURNING *",
      [instance, visibility.showInPublicList, visibility.showNextToName]);
    return { instance: instanceFromRow(updated.rows[0]), changed: true };
  });
}

export async function getAwardWithDatabase(database: AwardReader, awardId: string): Promise<Award | null> {
  const result = await database.query("SELECT *, established_on::text AS established_on FROM awards WHERE id = $1::uuid", [id(awardId)]);
  return result.rowCount ? awardFromRow(result.rows[0]) : null;
}
export async function getAwardInstanceWithDatabase(database: AwardReader, instanceId: string, viewerParticipantId: string): Promise<AwardInstance | null> {
  const result = await database.query("SELECT * FROM award_instances WHERE id = $1::uuid AND participant_id = $2::uuid", [id(instanceId), id(viewerParticipantId)]);
  return result.rowCount ? instanceFromRow(result.rows[0]) : null;
}

export async function establishAward(actorId: string, input: EstablishAwardInput) {
  const { pool } = await import("./db"); return establishAwardWithDatabase(pool, actorId, input);
}
export async function offerAward(actorId: string, input: OfferAwardInput) {
  const { pool } = await import("./db"); return offerAwardWithDatabase(pool, actorId, input);
}
export async function actOnAwardInstance(actorId: string, instanceId: string, action: AwardInstanceAction) {
  const { pool } = await import("./db"); return actOnAwardInstanceWithDatabase(pool, actorId, instanceId, action);
}
export async function setAwardVisibility(actorId: string, instanceId: string, visibility: { showInPublicList: boolean; showNextToName: boolean }) {
  const { pool } = await import("./db"); return setAwardVisibilityWithDatabase(pool, actorId, instanceId, visibility);
}
