import { normalizeDisplayName } from "./profile";
import { getOnboardingActionReward, type OnboardingReward } from "./onboarding-quests";
import { ProfileAboutValidationError, normalizeBoundedText } from "./profile-validation";
import {
  normalizeProfileVisibility, listParticipantSignalsWithDatabase, createSignalWithDatabase,
  archiveSignalWithDatabase, type Signal, type SignalTypeKey, type SignalVisibility, type ProfileVisibility,
} from "./signals";
import { addLegacyProfileSignalWithDatabase, signalBodyProjection } from "./signal-compat";

export { ProfileAboutValidationError } from "./profile-validation";
export {
  PROFILE_VISIBILITIES, normalizeProfileVisibility, normalizeSignalVisibility,
  normalizeSignalLabel, normalizeSignalDescription, normalizeSignalTypeKey as normalizeSignalKind,
  listSignalTypesWithDatabase, listSignalTypes,
} from "./signals";
export { PROFILE_SIGNAL_KINDS, normalizeSignalBody } from "./signal-compat";
export type { ProfileVisibility, SignalType } from "./signals";
export type { LegacyProfileSignalKind } from "./signal-compat";
export type ProfileSignalKind = SignalTypeKey;
export type ProfileSignalVisibility = SignalVisibility;

export type ProfileInterest = {
  id: string;
  label: string;
  visibility: ProfileVisibility;
};

export type ProfileResource = { id: string; url: string };

export type ProfileSignal = Pick<Signal, "id" | "label" | "description" | "visibility" | "legacyBody"> & {
  kind: SignalTypeKey;
  body: string;
};

export type Residence = {
  name: string;
  /** Legacy metadata; not part of geographical identity. */
  type?: string;
  country?: string;
};

export type ResidenceFields = {
  name: string | null;
};

export type ProfileAbout = {
  bio: string;
  bioVisibility: ProfileVisibility;
  age?: number | null;
  city?: string | null;
  occupation?: string | null;
  education?: string | null;
  familyStatus?: string | null;
  residence: Residence | null;
  interests: ProfileInterest[];
  resources: ProfileResource[];
  signals: ProfileSignal[];
};

type QueryResult = {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
};

export type ProfileAboutDatabaseClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};

export type ProfileAboutDatabase = {
  connect(): Promise<ProfileAboutDatabaseClient>;
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

export function normalizeProfileBio(value: unknown): string {
  if (typeof value !== "string") {
    throw new ProfileAboutValidationError("Bio must be text");
  }
  const normalized = value.trim();
  if (normalized.length > 2000) {
    throw new ProfileAboutValidationError("Bio is too long");
  }
  return normalized;
}

export function normalizeResidence(values: { name: unknown; type?: unknown; country?: unknown }): Residence | null {
  const fields = normalizeResidenceFields(values);
  if (!fields.name) return null;
  return { name: fields.name };
}

export function normalizeResidenceFields(values: { name: unknown; type?: unknown; country?: unknown }): ResidenceFields {
  if (typeof values.name !== "string") {
    throw new ProfileAboutValidationError("Residence must be text");
  }
  const name = values.name.trim().replace(/\s+/gu, " ");
  if (!name) return { name: null };
  if (name.length > 200) {
    throw new ProfileAboutValidationError("Invalid residence");
  }
  return { name };
}

export function residenceLabel(residence: Residence): string {
  return residence.name;
}

export function residenceKey(residence: Residence): string {
  return residence.name.trim().toLocaleLowerCase("ru-RU");
}

export function residenceDirectoryHref(residence: Residence): string {
  const params = new URLSearchParams({
    residence_name: residence.name,
  });
  return `/participants?${params.toString()}`;
}

export function normalizeInterest(value: unknown): string {
  return normalizeBoundedText(value, "Interest", 80);
}

function aboutFromRows(
  participantRow: Record<string, unknown>,
  interestRows: Array<Record<string, unknown>>,
  resourceRows: Array<Record<string, unknown>>,
  signals: Signal[],
): ProfileAbout {
  const residenceName = participantRow.city || participantRow.residence_name;
  const hasResidence = typeof residenceName === "string" && residenceName.trim().length > 0;
  return {
    bio: String(participantRow.profile_bio ?? ""),
    bioVisibility: String(participantRow.profile_bio_visibility) as ProfileVisibility,
    age: participantRow.profile_age === null || participantRow.profile_age === undefined ? null : Number(participantRow.profile_age),
    city: residenceName ? String(residenceName) : null,
    occupation: participantRow.profile_occupation ? String(participantRow.profile_occupation) : null,
    education: participantRow.profile_education ? String(participantRow.profile_education) : null,
    familyStatus: participantRow.profile_family_status ? String(participantRow.profile_family_status) : null,
    residence: hasResidence
      ? { name: String(residenceName) }
      : null,
    interests: interestRows.map((row) => ({
      id: String(row.id),
      label: String(row.label),
      visibility: String(row.visibility) as ProfileVisibility,
    })),
    resources: resourceRows.map((row) => ({ id: String(row.id), url: String(row.url) })),
    signals: signals.map((signal) => ({
      id: signal.id, kind: signal.typeKey, label: signal.label, description: signal.description,
      legacyBody: signal.legacyBody, body: signalBodyProjection(signal), visibility: signal.visibility,
    })),
  };
}

export async function getProfileAboutWithDatabase(
  database: Pick<ProfileAboutDatabase, "query">,
  participantId: string,
  includeSignals = true,
): Promise<ProfileAbout | null> {
  const [participant, interests, resources, signals] = await Promise.all([
    database.query(
      `SELECT profile_bio, profile_bio_visibility,
              profile_age, residence_name AS city,
              profile_occupation, profile_education, profile_family_status
         FROM participants
        WHERE id = $1::uuid`,
      [participantId],
    ),
    database.query(
      `SELECT id, label, visibility
         FROM participant_interests
        WHERE participant_id = $1::uuid
        ORDER BY created_at, id`,
      [participantId],
    ),
    database.query(
      `SELECT id, url FROM participant_profile_resources
        WHERE participant_id = $1::uuid ORDER BY created_at, id`,
      [participantId],
    ),
    includeSignals ? listParticipantSignalsWithDatabase(database, participantId, participantId) : Promise.resolve([]),
  ]);
  if (!participant.rowCount) return null;
  return aboutFromRows(participant.rows[0], interests.rows, resources.rows, signals);
}

export async function getVisibleProfileAboutWithDatabase(
  database: Pick<ProfileAboutDatabase, "query">,
  participantId: string,
  viewerParticipantId: string,
  includeSignals = true,
): Promise<ProfileAbout | null> {
  if (participantId === viewerParticipantId) {
    return getProfileAboutWithDatabase(database, participantId, includeSignals);
  }

  const [participant, interests, resources, signals] = await Promise.all([
    database.query(
      `SELECT CASE
                WHEN profile_bio_visibility IN ('public', 'members')
                  THEN profile_bio
                ELSE ''
              END AS profile_bio,
              profile_bio_visibility,
              NULL AS profile_age, residence_name AS city,
              profile_occupation, NULL AS profile_education, NULL AS profile_family_status
         FROM participants
        WHERE id = $1::uuid`,
      [participantId],
    ),
    database.query(
      `SELECT id, label, visibility
         FROM participant_interests
        WHERE participant_id = $1::uuid
          AND visibility IN ('public', 'members')
        ORDER BY created_at, id`,
      [participantId],
    ),
    database.query(
      `SELECT id, url FROM participant_profile_resources
        WHERE participant_id = $1::uuid ORDER BY created_at, id`,
      [participantId],
    ),
    includeSignals ? listParticipantSignalsWithDatabase(database, participantId, viewerParticipantId) : Promise.resolve([]),
  ]);
  if (!participant.rowCount) return null;
  return aboutFromRows(participant.rows[0], interests.rows, resources.rows, signals);
}

export function normalizeProfileResourceUrl(value: unknown): string {
  const input = normalizeBoundedText(value, "Resource URL", 2048);
  let url: URL;
  try { url = new URL(input); } catch { throw new ProfileAboutValidationError("Invalid resource URL"); }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname || url.username || url.password) {
    throw new ProfileAboutValidationError("Invalid resource URL");
  }
  url.hash = "";
  return url.toString();
}

export async function addProfileResourceWithDatabase(
  database: ProfileAboutDatabase, participantId: string, urlValue: unknown,
): Promise<void> {
  const url = normalizeProfileResourceUrl(urlValue);
  await withProfileTransaction(database, async (client) => {
    const result = await client.query(
      `INSERT INTO participant_profile_resources(participant_id, url, normalized_url)
       VALUES ($1::uuid, $2, $3) ON CONFLICT (participant_id, normalized_url) DO NOTHING RETURNING id`,
      [participantId, url, url],
    );
    if (!result.rowCount) throw new ProfileAboutValidationError("Resource already exists");
    await recordEvent(client, participantId, "participant.profile_resource_added", {
      resource_id: String(result.rows[0]?.id ?? ""),
    });
  });
}

export async function removeProfileResourceWithDatabase(
  database: ProfileAboutDatabase, participantId: string, resourceId: string,
): Promise<void> {
  await withProfileTransaction(database, async (client) => {
    const result = await client.query(
      `DELETE FROM participant_profile_resources WHERE id = $1::uuid AND participant_id = $2::uuid RETURNING id`,
      [resourceId, participantId],
    );
    if (result.rowCount) await recordEvent(client, participantId, "participant.profile_resource_removed", {
      resource_id: resourceId,
    });
  });
}

async function withProfileTransaction<T>(
  database: ProfileAboutDatabase,
  work: (client: ProfileAboutDatabaseClient) => Promise<T>,
): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original error.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function recordEvent(
  client: ProfileAboutDatabaseClient,
  participantId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO events(event_type, participant_id, payload)
     VALUES ($1, $2::uuid, $3::jsonb)`,
    [eventType, participantId, JSON.stringify(payload)],
  );
}

export async function updateProfileBioWithDatabase(
  database: ProfileAboutDatabase,
  participantId: string,
  bioValue: unknown,
  visibilityValue: unknown,
): Promise<void> {
  const bio = normalizeProfileBio(bioValue);
  const visibility = normalizeProfileVisibility(visibilityValue);
  await withProfileTransaction(database, async (client) => {
    await client.query(
      `UPDATE participants
          SET profile_bio = $2,
              profile_bio_visibility = $3,
              updated_at = now()
        WHERE id = $1::uuid`,
      [participantId, bio, visibility],
    );
    await recordEvent(client, participantId, "participant.about_updated", {
      field: "bio",
      visibility,
    });
  });
}

export async function saveProfileWithDatabase(
  database: ProfileAboutDatabase,
  participantId: string,
  displayNameValue: unknown,
  bioValue: unknown,
  visibilityValue: unknown,
  residenceValues?: { name: unknown; type?: unknown; country?: unknown },
): Promise<{ changed: boolean; reward?: OnboardingReward }> {
  const displayName = normalizeDisplayName(displayNameValue);
  const bio = normalizeProfileBio(bioValue);
  const visibility = normalizeProfileVisibility(visibilityValue);
  const residence = residenceValues === undefined ? undefined : normalizeResidenceFields(residenceValues);

  return withProfileTransaction(database, async (client) => {
    const result = await client.query(
      `SELECT display_name, profile_bio, profile_bio_visibility,
              residence_name
         FROM participants
        WHERE id = $1::uuid
        FOR UPDATE`,
      [participantId],
    );
    if (!result.rowCount) throw new Error("Participant not found");

    const previous = result.rows[0];
    const oldDisplayName = String(previous.display_name);
    const nameChanged = oldDisplayName !== displayName;
    const bioChanged = String(previous.profile_bio ?? "") !== bio
      || String(previous.profile_bio_visibility) !== visibility;
    const previousResidence = previous.residence_name
      ? { name: String(previous.residence_name) }
      : null;
    const nextResidence = residence === undefined ? previousResidence : residence.name ? residence : null;
    const residenceChanged = previousResidence?.name !== nextResidence?.name;
    const changed = nameChanged || bioChanged || residenceChanged;

    await client.query(
      `UPDATE participants
          SET display_name = $2,
              display_name_chosen_in_core = true,
              profile_bio = $3,
              profile_bio_visibility = $4,
              residence_name = $6,
              updated_at = CASE WHEN $5::boolean THEN now() ELSE updated_at END
        WHERE id = $1::uuid`,
      [participantId, displayName, bio, visibility, changed,
        nextResidence?.name ?? null],
    );
    if (nameChanged) {
      await recordEvent(client, participantId, "participant.profile_updated", {
        old_display_name: oldDisplayName,
        new_display_name: displayName,
      });
    }
    if (bioChanged) {
      await recordEvent(client, participantId, "participant.about_updated", {
        field: "bio",
        visibility,
      });
    }
    if (residenceChanged) {
      await recordEvent(client, participantId, "participant.about_updated", { field: "residence" });
    }
    const reward = residenceChanged && nextResidence
      ? await getOnboardingActionReward(client, participantId, "residence_first_filled") : undefined;
    return reward ? { changed, reward } : { changed };
  });
}

export async function addProfileInterestWithDatabase(
  database: ProfileAboutDatabase,
  participantId: string,
  labelValue: unknown,
  visibilityValue: unknown,
): Promise<OnboardingReward | undefined> {
  const label = normalizeInterest(labelValue);
  const visibility = normalizeProfileVisibility(visibilityValue);
  const normalizedLabel = label.toLocaleLowerCase("ru-RU");

  return withProfileTransaction(database, async (client) => {
    const result = await client.query(
      `INSERT INTO participant_interests(participant_id, label, normalized_label, visibility)
       VALUES ($1::uuid, $2, $3, $4)
       ON CONFLICT (participant_id, normalized_label)
       DO NOTHING
       RETURNING id`,
      [participantId, label, normalizedLabel, visibility],
    );
    if (!result.rowCount) throw new ProfileAboutValidationError("Interest already exists");
    await recordEvent(client, participantId, "participant.interest_saved", {
      interest_id: String(result.rows[0]?.id ?? ""),
      visibility,
    });
    return getOnboardingActionReward(client, participantId, "interest_first_added");
  });
}

// Edits keep the same interest ID and are restricted to its owner.
export async function updateProfileInterestWithDatabase(
  database: ProfileAboutDatabase,
  participantId: string,
  interestId: string,
  labelValue: unknown,
  visibilityValue: unknown,
): Promise<void> {
  const label = normalizeInterest(labelValue);
  const normalizedLabel = label.toLocaleLowerCase("ru-RU");
  const visibility = normalizeProfileVisibility(visibilityValue);
  await withProfileTransaction(database, async (client) => {
    const duplicate = await client.query(
      `SELECT 1 FROM participant_interests
        WHERE participant_id = $1::uuid AND normalized_label = $2 AND id <> $3::uuid
        LIMIT 1`,
      [participantId, normalizedLabel, interestId],
    );
    if (duplicate.rowCount) throw new ProfileAboutValidationError("Interest already exists");
    const result = await client.query(
      `UPDATE participant_interests SET label = $3, normalized_label = $4,
          visibility = $5, updated_at = now()
        WHERE id = $1::uuid AND participant_id = $2::uuid
        RETURNING id`,
      [interestId, participantId, label, normalizedLabel, visibility],
    );
    if (!result.rowCount) throw new ProfileAboutValidationError("Interest not found");
    await recordEvent(client, participantId, "participant.interest_saved", {
      interest_id: interestId,
      visibility,
    });
  });
}

export async function removeProfileInterestWithDatabase(
  database: ProfileAboutDatabase,
  participantId: string,
  interestId: string,
): Promise<void> {
  await withProfileTransaction(database, async (client) => {
    const result = await client.query(
      `DELETE FROM participant_interests
        WHERE id = $1::uuid
          AND participant_id = $2::uuid
       RETURNING id`,
      [interestId, participantId],
    );
    if (result.rowCount) {
      await recordEvent(client, participantId, "participant.interest_removed", {
        interest_id: interestId,
      });
    }
  });
}

// Compatibility facade for existing routes and A1 callers.
export const addProfileSignalWithDatabase = addLegacyProfileSignalWithDatabase;
export const archiveProfileSignalWithDatabase = archiveSignalWithDatabase;
export type CreateProfileSignalInput = { kind: unknown; label: unknown; description?: unknown; visibility: unknown };
export async function createProfileSignalWithDatabase(
  database: ProfileAboutDatabase, participantId: string, input: CreateProfileSignalInput,
): Promise<{ id: string; reward?: OnboardingReward }> {
  const { signal, reward } = await createSignalWithDatabase(database, participantId, {
    typeKey: input.kind, label: input.label, description: input.description, visibility: input.visibility,
  });
  return reward ? { id: signal.id, reward } : { id: signal.id };
}

export async function getProfileAbout(participantId: string, includeSignals = true) {
  const { pool } = await import("./db");
  return getProfileAboutWithDatabase(pool, participantId, includeSignals);
}

export async function getVisibleProfileAbout(
  participantId: string,
  viewerParticipantId: string,
  includeSignals = true,
) {
  const { pool } = await import("./db");
  return getVisibleProfileAboutWithDatabase(pool, participantId, viewerParticipantId, includeSignals);
}

export async function updateProfileBio(
  participantId: string,
  bio: unknown,
  visibility: unknown,
) {
  const { pool } = await import("./db");
  return updateProfileBioWithDatabase(pool, participantId, bio, visibility);
}

export async function saveProfile(
  participantId: string,
  displayName: unknown,
  bio: unknown,
  visibility: unknown,
  residence?: { name: unknown; type?: unknown; country?: unknown },
) {
  const { pool } = await import("./db");
  return saveProfileWithDatabase(pool, participantId, displayName, bio, visibility, residence);
}

export async function addProfileInterest(
  participantId: string,
  label: unknown,
  visibility: unknown,
) {
  const { pool } = await import("./db");
  return addProfileInterestWithDatabase(pool, participantId, label, visibility);
}

export async function updateProfileInterest(
  participantId: string,
  interestId: string,
  label: unknown,
  visibility: unknown,
) {
  const { pool } = await import("./db");
  return updateProfileInterestWithDatabase(pool, participantId, interestId, label, visibility);
}

export async function removeProfileInterest(participantId: string, interestId: string) {
  const { pool } = await import("./db");
  return removeProfileInterestWithDatabase(pool, participantId, interestId);
}

export async function addProfileResource(participantId: string, url: unknown) {
  const { pool } = await import("./db");
  return addProfileResourceWithDatabase(pool, participantId, url);
}

export async function removeProfileResource(participantId: string, resourceId: string) {
  const { pool } = await import("./db");
  return removeProfileResourceWithDatabase(pool, participantId, resourceId);
}

export async function addProfileSignal(
  participantId: string,
  kind: unknown,
  body: unknown,
  visibility: unknown,
) {
  const { pool } = await import("./db");
  return addProfileSignalWithDatabase(pool, participantId, kind, body, visibility);
}

export async function createProfileSignal(participantId: string, input: CreateProfileSignalInput) {
  const { pool } = await import("./db");
  return createProfileSignalWithDatabase(pool, participantId, input);
}

export async function archiveProfileSignal(participantId: string, signalId: string) {
  const { pool } = await import("./db");
  return archiveProfileSignalWithDatabase(pool, participantId, signalId);
}
