export const PROFILE_VISIBILITIES = [
  "public",
  "members",
  "circle",
  "match_only",
  "private",
] as const;

export type ProfileVisibility = (typeof PROFILE_VISIBILITIES)[number];

export const PROFILE_SIGNAL_KINDS = ["want", "need", "can", "have"] as const;
export type ProfileSignalKind = (typeof PROFILE_SIGNAL_KINDS)[number];

export type ProfileInterest = {
  id: string;
  label: string;
  visibility: ProfileVisibility;
};

export type ProfileSignal = {
  id: string;
  kind: ProfileSignalKind;
  body: string;
  visibility: ProfileVisibility;
};

export type ProfileAbout = {
  bio: string;
  bioVisibility: ProfileVisibility;
  interests: ProfileInterest[];
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

export class ProfileAboutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileAboutValidationError";
  }
}

function normalizeBoundedText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new ProfileAboutValidationError(`${field} must be text`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new ProfileAboutValidationError(`${field} must not be empty`);
  }
  if (normalized.length > maxLength) {
    throw new ProfileAboutValidationError(`${field} is too long`);
  }
  return normalized;
}

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

export function normalizeInterest(value: unknown): string {
  return normalizeBoundedText(value, "Interest", 80);
}

export function normalizeSignalBody(value: unknown): string {
  return normalizeBoundedText(value, "Signal", 500);
}

export function normalizeProfileVisibility(value: unknown): ProfileVisibility {
  if (
    typeof value !== "string" ||
    !PROFILE_VISIBILITIES.includes(value as ProfileVisibility)
  ) {
    throw new ProfileAboutValidationError("Invalid visibility");
  }
  return value as ProfileVisibility;
}

export function normalizeSignalKind(value: unknown): ProfileSignalKind {
  if (
    typeof value !== "string" ||
    !PROFILE_SIGNAL_KINDS.includes(value as ProfileSignalKind)
  ) {
    throw new ProfileAboutValidationError("Invalid signal kind");
  }
  return value as ProfileSignalKind;
}

function aboutFromRows(
  participantRow: Record<string, unknown>,
  interestRows: Array<Record<string, unknown>>,
  signalRows: Array<Record<string, unknown>>,
): ProfileAbout {
  return {
    bio: String(participantRow.profile_bio ?? ""),
    bioVisibility: String(participantRow.profile_bio_visibility) as ProfileVisibility,
    interests: interestRows.map((row) => ({
      id: String(row.id),
      label: String(row.label),
      visibility: String(row.visibility) as ProfileVisibility,
    })),
    signals: signalRows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind) as ProfileSignalKind,
      body: String(row.body),
      visibility: String(row.visibility) as ProfileVisibility,
    })),
  };
}

export async function getProfileAboutWithDatabase(
  database: Pick<ProfileAboutDatabase, "query">,
  participantId: string,
): Promise<ProfileAbout | null> {
  const [participant, interests, signals] = await Promise.all([
    database.query(
      `SELECT profile_bio, profile_bio_visibility
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
      `SELECT id, kind, body, visibility
         FROM profile_signals
        WHERE participant_id = $1::uuid
          AND status = 'active'
        ORDER BY created_at DESC, id DESC`,
      [participantId],
    ),
  ]);
  if (!participant.rowCount) return null;
  return aboutFromRows(participant.rows[0], interests.rows, signals.rows);
}

export async function getVisibleProfileAboutWithDatabase(
  database: Pick<ProfileAboutDatabase, "query">,
  participantId: string,
  viewerParticipantId: string,
): Promise<ProfileAbout | null> {
  if (participantId === viewerParticipantId) {
    return getProfileAboutWithDatabase(database, participantId);
  }

  const [participant, interests, signals] = await Promise.all([
    database.query(
      `SELECT CASE
                WHEN profile_bio_visibility IN ('public', 'members')
                  THEN profile_bio
                ELSE ''
              END AS profile_bio,
              profile_bio_visibility
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
      `SELECT id, kind, body, visibility
         FROM profile_signals
        WHERE participant_id = $1::uuid
          AND status = 'active'
          AND visibility IN ('public', 'members')
        ORDER BY created_at DESC, id DESC`,
      [participantId],
    ),
  ]);
  if (!participant.rowCount) return null;
  return aboutFromRows(participant.rows[0], interests.rows, signals.rows);
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

export async function addProfileInterestWithDatabase(
  database: ProfileAboutDatabase,
  participantId: string,
  labelValue: unknown,
  visibilityValue: unknown,
): Promise<void> {
  const label = normalizeInterest(labelValue);
  const visibility = normalizeProfileVisibility(visibilityValue);
  const normalizedLabel = label.toLocaleLowerCase("ru-RU");

  await withProfileTransaction(database, async (client) => {
    const result = await client.query(
      `INSERT INTO participant_interests(participant_id, label, normalized_label, visibility)
       VALUES ($1::uuid, $2, $3, $4)
       ON CONFLICT (participant_id, normalized_label)
       DO UPDATE SET label = EXCLUDED.label,
                     visibility = EXCLUDED.visibility,
                     updated_at = now()
       RETURNING id`,
      [participantId, label, normalizedLabel, visibility],
    );
    await recordEvent(client, participantId, "participant.interest_saved", {
      interest_id: String(result.rows[0]?.id ?? ""),
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

export async function addProfileSignalWithDatabase(
  database: ProfileAboutDatabase,
  participantId: string,
  kindValue: unknown,
  bodyValue: unknown,
  visibilityValue: unknown,
): Promise<void> {
  const kind = normalizeSignalKind(kindValue);
  const body = normalizeSignalBody(bodyValue);
  const visibility = normalizeProfileVisibility(visibilityValue);

  await withProfileTransaction(database, async (client) => {
    const result = await client.query(
      `INSERT INTO profile_signals(participant_id, kind, body, visibility)
       VALUES ($1::uuid, $2, $3, $4)
       RETURNING id`,
      [participantId, kind, body, visibility],
    );
    await recordEvent(client, participantId, "participant.signal_created", {
      signal_id: String(result.rows[0]?.id ?? ""),
      kind,
      visibility,
    });
  });
}

export async function archiveProfileSignalWithDatabase(
  database: ProfileAboutDatabase,
  participantId: string,
  signalId: string,
): Promise<void> {
  await withProfileTransaction(database, async (client) => {
    const result = await client.query(
      `UPDATE profile_signals
          SET status = 'archived',
              updated_at = now()
        WHERE id = $1::uuid
          AND participant_id = $2::uuid
          AND status = 'active'
       RETURNING id`,
      [signalId, participantId],
    );
    if (result.rowCount) {
      await recordEvent(client, participantId, "participant.signal_archived", {
        signal_id: signalId,
      });
    }
  });
}

export async function getProfileAbout(participantId: string) {
  const { pool } = await import("./db");
  return getProfileAboutWithDatabase(pool, participantId);
}

export async function getVisibleProfileAbout(
  participantId: string,
  viewerParticipantId: string,
) {
  const { pool } = await import("./db");
  return getVisibleProfileAboutWithDatabase(pool, participantId, viewerParticipantId);
}

export async function updateProfileBio(
  participantId: string,
  bio: unknown,
  visibility: unknown,
) {
  const { pool } = await import("./db");
  return updateProfileBioWithDatabase(pool, participantId, bio, visibility);
}

export async function addProfileInterest(
  participantId: string,
  label: unknown,
  visibility: unknown,
) {
  const { pool } = await import("./db");
  return addProfileInterestWithDatabase(pool, participantId, label, visibility);
}

export async function removeProfileInterest(participantId: string, interestId: string) {
  const { pool } = await import("./db");
  return removeProfileInterestWithDatabase(pool, participantId, interestId);
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

export async function archiveProfileSignal(participantId: string, signalId: string) {
  const { pool } = await import("./db");
  return archiveProfileSignalWithDatabase(pool, participantId, signalId);
}
