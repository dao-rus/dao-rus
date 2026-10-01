import { VERIFIED_SUBJECTS_CTE } from "./verification";
import type { Residence } from "./profile-about";

export type ParticipantDirectoryEntry = {
  participantId: string;
  displayName: string;
  telegramUsername: string | null;
  telegramBio: string | null;
  avatarUrl: string | null;
  hasTelegramPhoto: boolean;
  verificationPoints: number;
  positiveCount: number;
  residence: Residence | null;
};

export type DirectorySort = "name" | "verification" | "reputation";
type DirectoryFilters = { interest?: string; residence?: Residence | null; viewerParticipantId?: string; sort?: DirectorySort };

type QueryResult = {
  rows: Array<Record<string, unknown>>;
};

export type ParticipantDirectoryDatabase = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

export async function listParticipantsDirectoryWithDatabase(
  database: ParticipantDirectoryDatabase,
  search = "",
  filters: DirectoryFilters = {},
): Promise<ParticipantDirectoryEntry[]> {
  const normalizedSearch = search.trim().replace(/^@+/, "");
  const normalizedInterest = filters.interest?.trim().toLocaleLowerCase("ru-RU") ?? "";
  const residence = filters.residence;
  const orderBy = filters.sort === "verification" ? "verification_points DESC, "
    : filters.sort === "reputation" ? "positive_count DESC, " : "";
  const result = await database.query(
    `${VERIFIED_SUBJECTS_CTE}
     SELECT participant.id AS participant_id,
            participant.display_name,
            telegram.username AS telegram_username,
            telegram.bot_profile->>'bio' AS telegram_bio,
            telegram.avatar_url,
            telegram.bot_profile->'photo'->>'file_id' AS telegram_photo_file_id,
            telegram.bot_profile->>'photo_count' AS telegram_photo_count,
            participant.residence_name,
            participant.residence_type,
            participant.residence_country,
            (
              SELECT count(*)::integer
                FROM verification_attestations incoming
                JOIN verified verifier
                  ON verifier.subject_id = incoming.verifier_subject_id
               WHERE incoming.subject_id = participant.id
                 AND incoming.revoked_at IS NULL
            ) AS verification_points,
            (SELECT count(*)::integer FROM reputation_signals reputation
              WHERE reputation.subject_participant_id = participant.id
                AND reputation.dimension = 'interaction_quality'
                AND reputation.signal_type = 'positive' AND reputation.revoked_at IS NULL) AS positive_count
       FROM participants participant
       LEFT JOIN external_identities telegram
         ON telegram.participant_id = participant.id
        AND telegram.provider = 'telegram'
      WHERE EXISTS (
        SELECT 1 FROM events login
         WHERE login.participant_id = participant.id
           AND login.event_type = 'participant.logged_in'
      )
        AND (
          $1::text = ''
          OR participant.display_name ILIKE '%' || $1 || '%'
          OR COALESCE(telegram.username, '') ILIKE '%' || $1 || '%'
        )
        AND (
          $2::text = ''
          OR EXISTS (
            SELECT 1 FROM participant_interests interest
             WHERE interest.participant_id = participant.id
               AND interest.normalized_label = $2
               AND (
                 interest.visibility IN ('public', 'members')
                 OR interest.participant_id = $3::uuid
               )
          )
        )
        AND (
          $4::text = ''
          OR (
            lower(participant.residence_name) = $4
            AND lower(participant.residence_type) = $5
            AND lower(participant.residence_country) = $6
          )
        )
      ORDER BY ${orderBy}lower(participant.display_name), participant.id`,
    [normalizedSearch, normalizedInterest, filters.viewerParticipantId ?? null,
      residence?.name.toLocaleLowerCase("ru-RU") ?? "",
      residence?.type.toLocaleLowerCase("ru-RU") ?? "",
      residence?.country.toLocaleLowerCase("ru-RU") ?? ""],
  );

  return result.rows.map((row) => ({
    participantId: String(row.participant_id),
    displayName: String(row.display_name),
    telegramUsername: row.telegram_username
      ? String(row.telegram_username)
      : null,
    telegramBio: row.telegram_bio ? String(row.telegram_bio) : null,
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    hasTelegramPhoto: Boolean(row.telegram_photo_file_id) && row.telegram_photo_count !== "0",
    verificationPoints: Number(row.verification_points),
    positiveCount: Number(row.positive_count ?? 0),
    residence: row.residence_name && row.residence_type && row.residence_country
      ? {
          name: String(row.residence_name),
          type: String(row.residence_type),
          country: String(row.residence_country),
        }
      : null,
  }));
}

export async function listParticipantsDirectory(
  search = "",
  filters: DirectoryFilters = {},
) {
  const { pool } = await import("./db");
  return listParticipantsDirectoryWithDatabase(pool, search, filters);
}
