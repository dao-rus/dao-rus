export type VerificationEdge = {
  verifierSubjectId: string;
  subjectId: string;
  revokedAt?: Date | null;
};

export type DerivedVerification = {
  verifiedSubjectIds: Set<string>;
  pointsBySubjectId: Map<string, number>;
};

export type VerificationProfile = {
  subjectId: string;
  displayName: string;
  telegramName: string | null;
  telegramUsername: string | null;
  telegramBio: string | null;
  avatarUrl: string | null;
  hasTelegramPhoto: boolean;
  hasLoggedIn: boolean;
  membershipStatus: string;
  isRoot: boolean;
  isVerified: boolean;
  verificationPoints: number;
  viewerIsVerified: boolean;
  viewerAttestationId: string | null;
};

type QueryResult = {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
};

export type VerificationDatabaseClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};

export type VerificationDatabase = {
  connect(): Promise<VerificationDatabaseClient>;
};

export class VerificationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationValidationError";
  }
}

export class VerificationNotFoundError extends Error {
  constructor(message = "Core Subject not found") {
    super(message);
    this.name = "VerificationNotFoundError";
  }
}

export class VerificationEligibilityError extends Error {
  constructor(message = "Only a verified Core Subject may create an attestation") {
    super(message);
    this.name = "VerificationEligibilityError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeSubjectId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new VerificationValidationError("Invalid Core Subject ID");
  }
  return value.toLowerCase();
}

export const VERIFIED_SUBJECTS_CTE = `WITH RECURSIVE verified(subject_id) AS (
  SELECT subject_id FROM verification_roots
  UNION
  SELECT attestation.subject_id
    FROM verification_attestations attestation
    JOIN verified verifier
      ON verifier.subject_id = attestation.verifier_subject_id
   WHERE attestation.revoked_at IS NULL
)`;

export function deriveVerificationGraph(
  roots: readonly string[],
  attestations: readonly VerificationEdge[],
): DerivedVerification {
  const active = attestations.filter((edge) => !edge.revokedAt);
  const verifiedSubjectIds = new Set(roots);
  let changed = true;

  while (changed) {
    changed = false;
    for (const edge of active) {
      if (
        verifiedSubjectIds.has(edge.verifierSubjectId) &&
        !verifiedSubjectIds.has(edge.subjectId)
      ) {
        verifiedSubjectIds.add(edge.subjectId);
        changed = true;
      }
    }
  }

  const pointsBySubjectId = new Map<string, number>();
  for (const edge of active) {
    if (!verifiedSubjectIds.has(edge.verifierSubjectId)) continue;
    pointsBySubjectId.set(
      edge.subjectId,
      (pointsBySubjectId.get(edge.subjectId) ?? 0) + 1,
    );
  }

  return { verifiedSubjectIds, pointsBySubjectId };
}

function profileFromRow(row: Record<string, unknown>): VerificationProfile {
  return {
    subjectId: String(row.subject_id),
    displayName: String(row.display_name),
    telegramName: row.telegram_name ? String(row.telegram_name) : null,
    telegramUsername: row.telegram_username ? String(row.telegram_username) : null,
    telegramBio: row.telegram_bio ? String(row.telegram_bio) : null,
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    hasTelegramPhoto: Boolean(row.telegram_photo_file_id) && row.telegram_photo_count !== "0",
    hasLoggedIn: Boolean(row.has_logged_in),
    membershipStatus: String(row.membership_status),
    isRoot: Boolean(row.is_root),
    isVerified: Boolean(row.is_verified),
    verificationPoints: Number(row.verification_points),
    viewerIsVerified: Boolean(row.viewer_is_verified),
    viewerAttestationId: row.viewer_attestation_id
      ? String(row.viewer_attestation_id)
      : null,
  };
}

export async function getVerificationProfileWithDatabase(
  database: Pick<VerificationDatabaseClient, "query">,
  subjectId: string,
  viewerSubjectId: string,
): Promise<VerificationProfile | null> {
  if (!UUID_PATTERN.test(subjectId) || !UUID_PATTERN.test(viewerSubjectId)) return null;
  const result = await database.query(
    `${VERIFIED_SUBJECTS_CTE}
     SELECT subject.id AS subject_id,
            subject.display_name,
            telegram.oidc_profile->>'name' AS telegram_name,
            telegram.username AS telegram_username,
            telegram.bot_profile->>'bio' AS telegram_bio,
            telegram.avatar_url,
            telegram.bot_profile->'photo'->>'file_id' AS telegram_photo_file_id,
            telegram.bot_profile->>'photo_count' AS telegram_photo_count,
            EXISTS (
              SELECT 1 FROM events login
               WHERE login.participant_id = subject.id
                 AND login.event_type = 'participant.logged_in'
            ) AS has_logged_in,
            subject.membership_status,
            EXISTS (
              SELECT 1 FROM verification_roots root
               WHERE root.subject_id = subject.id
            ) AS is_root,
            EXISTS (
              SELECT 1 FROM verified
               WHERE verified.subject_id = subject.id
            ) AS is_verified,
            (
              SELECT count(*)::integer
                FROM verification_attestations incoming
                JOIN verified verifier
                  ON verifier.subject_id = incoming.verifier_subject_id
               WHERE incoming.subject_id = subject.id
                 AND incoming.revoked_at IS NULL
            ) AS verification_points,
            EXISTS (
              SELECT 1 FROM verified
               WHERE verified.subject_id = $2::uuid
            ) AS viewer_is_verified,
            (
              SELECT own.id
                FROM verification_attestations own
               WHERE own.verifier_subject_id = $2::uuid
                 AND own.subject_id = subject.id
                 AND own.revoked_at IS NULL
               LIMIT 1
            ) AS viewer_attestation_id
       FROM participants subject
       LEFT JOIN external_identities telegram
         ON telegram.participant_id = subject.id AND telegram.provider = 'telegram'
      WHERE subject.id = $1::uuid`,
    [subjectId, viewerSubjectId],
  );
  return result.rowCount ? profileFromRow(result.rows[0]) : null;
}

export async function getVerificationProfile(
  subjectId: string,
  viewerSubjectId: string,
): Promise<VerificationProfile | null> {
  const { pool } = await import("./db");
  return getVerificationProfileWithDatabase(pool, subjectId, viewerSubjectId);
}

async function subjectExists(
  client: VerificationDatabaseClient,
  subjectId: string,
): Promise<boolean> {
  const result = await client.query(
    "SELECT id FROM participants WHERE id = $1::uuid FOR SHARE",
    [subjectId],
  );
  return Boolean(result.rowCount);
}

async function subjectIsVerified(
  client: VerificationDatabaseClient,
  subjectId: string,
): Promise<boolean> {
  const result = await client.query(
    `${VERIFIED_SUBJECTS_CTE}
     SELECT EXISTS (
       SELECT 1 FROM verified WHERE subject_id = $1::uuid
     ) AS is_verified`,
    [subjectId],
  );
  return Boolean(result.rows[0]?.is_verified);
}

export type AttestationChange = {
  changed: boolean;
  attestationId: string | null;
};

export async function createVerificationAttestationWithDatabase(
  database: VerificationDatabase,
  verifierSubjectId: string,
  subjectId: string,
): Promise<AttestationChange> {
  verifierSubjectId = normalizeSubjectId(verifierSubjectId);
  subjectId = normalizeSubjectId(subjectId);
  if (verifierSubjectId === subjectId) {
    throw new VerificationValidationError("Self-verification is forbidden");
  }

  const client = await database.connect();
  try {
    await client.query("BEGIN");
    if (!(await subjectExists(client, verifierSubjectId))) {
      throw new VerificationNotFoundError("Verifier Core Subject not found");
    }
    if (!(await subjectExists(client, subjectId))) {
      throw new VerificationNotFoundError();
    }
    if (!(await subjectIsVerified(client, verifierSubjectId))) {
      throw new VerificationEligibilityError();
    }

    const existing = await client.query(
      `SELECT id
         FROM verification_attestations
        WHERE verifier_subject_id = $1::uuid
          AND subject_id = $2::uuid
          AND revoked_at IS NULL
        FOR UPDATE`,
      [verifierSubjectId, subjectId],
    );
    if (existing.rowCount) {
      await client.query("COMMIT");
      return { changed: false, attestationId: String(existing.rows[0].id) };
    }

    const inserted = await client.query(
      `INSERT INTO verification_attestations(verifier_subject_id, subject_id)
       VALUES ($1, $2)
       ON CONFLICT (verifier_subject_id, subject_id)
         WHERE revoked_at IS NULL
       DO NOTHING
       RETURNING id, created_at`,
      [verifierSubjectId, subjectId],
    );
    if (!inserted.rowCount) {
      const concurrent = await client.query(
        `SELECT id
           FROM verification_attestations
          WHERE verifier_subject_id = $1::uuid
            AND subject_id = $2::uuid
            AND revoked_at IS NULL`,
        [verifierSubjectId, subjectId],
      );
      await client.query("COMMIT");
      return {
        changed: false,
        attestationId: concurrent.rowCount ? String(concurrent.rows[0].id) : null,
      };
    }
    const attestationId = String(inserted.rows[0].id);
    const createdAt = new Date(String(inserted.rows[0].created_at)).toISOString();
    await client.query(
      `INSERT INTO events(event_type, participant_id, payload)
       VALUES ('verification.attestation_created', $1, $2::jsonb)`,
      [
        verifierSubjectId,
        JSON.stringify({
          attestation_id: attestationId,
          verifier_subject_id: verifierSubjectId,
          subject_id: subjectId,
          created_at: createdAt,
        }),
      ],
    );
    await client.query("COMMIT");
    return { changed: true, attestationId };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeVerificationAttestationWithDatabase(
  database: VerificationDatabase,
  verifierSubjectId: string,
  subjectId: string,
): Promise<AttestationChange> {
  verifierSubjectId = normalizeSubjectId(verifierSubjectId);
  subjectId = normalizeSubjectId(subjectId);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id
         FROM verification_attestations
        WHERE verifier_subject_id = $1::uuid
          AND subject_id = $2::uuid
          AND revoked_at IS NULL
        FOR UPDATE`,
      [verifierSubjectId, subjectId],
    );
    if (!existing.rowCount) {
      await client.query("COMMIT");
      return { changed: false, attestationId: null };
    }

    const attestationId = String(existing.rows[0].id);
    const updated = await client.query(
      `UPDATE verification_attestations
          SET revoked_at = now()
        WHERE id = $1
          AND revoked_at IS NULL
       RETURNING revoked_at`,
      [attestationId],
    );
    if (updated.rowCount !== 1) {
      throw new Error("Verification attestation changed concurrently");
    }
    const revokedAt = new Date(String(updated.rows[0].revoked_at)).toISOString();
    await client.query(
      `INSERT INTO events(event_type, participant_id, payload)
       VALUES ('verification.attestation_revoked', $1, $2::jsonb)`,
      [
        verifierSubjectId,
        JSON.stringify({
          attestation_id: attestationId,
          verifier_subject_id: verifierSubjectId,
          subject_id: subjectId,
          revoked_at: revokedAt,
        }),
      ],
    );
    await client.query("COMMIT");
    return { changed: true, attestationId };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function addVerificationRootWithDatabase(
  database: VerificationDatabase,
  adminParticipantId: string,
  subjectId: string,
): Promise<{ changed: boolean }> {
  adminParticipantId = normalizeSubjectId(adminParticipantId);
  subjectId = normalizeSubjectId(subjectId);
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    if (!(await subjectExists(client, adminParticipantId))) {
      throw new VerificationNotFoundError("Admin Core Subject not found");
    }
    if (!(await subjectExists(client, subjectId))) {
      throw new VerificationNotFoundError();
    }
    const inserted = await client.query(
      `INSERT INTO verification_roots(subject_id, added_by_participant_id)
       VALUES ($1, $2)
       ON CONFLICT (subject_id) DO NOTHING
       RETURNING created_at`,
      [subjectId, adminParticipantId],
    );
    if (!inserted.rowCount) {
      await client.query("COMMIT");
      return { changed: false };
    }
    const createdAt = new Date(String(inserted.rows[0].created_at)).toISOString();
    await client.query(
      `INSERT INTO events(event_type, participant_id, payload)
       VALUES ('verification.root_added', $1, $2::jsonb)`,
      [
        adminParticipantId,
        JSON.stringify({
          subject_id: subjectId,
          added_by_participant_id: adminParticipantId,
          created_at: createdAt,
        }),
      ],
    );
    await client.query("COMMIT");
    return { changed: true };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function createVerificationAttestation(
  verifierSubjectId: string,
  subjectId: string,
) {
  const { pool } = await import("./db");
  return createVerificationAttestationWithDatabase(pool, verifierSubjectId, subjectId);
}

export async function revokeVerificationAttestation(
  verifierSubjectId: string,
  subjectId: string,
) {
  const { pool } = await import("./db");
  return revokeVerificationAttestationWithDatabase(pool, verifierSubjectId, subjectId);
}

export async function addVerificationRoot(
  adminParticipantId: string,
  subjectId: string,
) {
  const { pool } = await import("./db");
  return addVerificationRootWithDatabase(pool, adminParticipantId, subjectId);
}
