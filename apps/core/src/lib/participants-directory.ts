import { VERIFIED_SUBJECTS_CTE } from "./verification";
import type { LegacyProfileSignalKind, Residence } from "./profile-about";

export type ParticipantDirectoryEntry = {
  participantId: string;
  displayName: string;
  telegramUsername: string | null;
  telegramBio: string | null;
  avatarUrl: string | null;
  hasTelegramPhoto: boolean;
  verificationPoints: number;
  positiveCount: number;
  signalCounts: Record<LegacyProfileSignalKind, number>;
  residence: Residence | null;
  profileAge: number | null;
  profileCity: string | null;
  profileOccupation: string | null;
  profileEducation: string | null;
  profileFamilyStatus: string | null;
  // The first known moment the person entered the DAO forum.
  joinedAt?: Date | null;
};

export type DirectorySort = "name" | "verification" | "reputation" | "core" | "joined";
export type DirectoryFilters = { withoutResidence?: boolean; interest?: string; residence?: Residence | null; viewerParticipantId?: string; sort?: DirectorySort; dir?: "asc" | "desc" };

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
    : filters.sort === "reputation" ? "positive_count DESC, "
    : filters.sort === "joined" ? `joined_at ${filters.dir === "desc" ? "DESC" : "ASC"} NULLS LAST, ` : "";
  const coreOnly = filters.sort === "core" ? `AND EXISTS (
          SELECT 1 FROM events core_login
           WHERE core_login.participant_id = participant.id
             AND core_login.event_type = 'participant.logged_in'
        )` : "";
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
            CASE WHEN participant.id = $3::uuid THEN participant.profile_age ELSE NULL END AS profile_age,
            participant.residence_name AS profile_city,
            participant.profile_occupation,
            CASE WHEN participant.id = $3::uuid THEN participant.profile_education ELSE NULL END AS profile_education,
            CASE WHEN participant.id = $3::uuid THEN participant.profile_family_status ELSE NULL END AS profile_family_status,
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
                AND reputation.signal_type = 'positive' AND reputation.revoked_at IS NULL) AS positive_count,
            (SELECT min(COALESCE((joined.payload->>'observed_at')::timestamptz, joined.created_at))
               FROM events joined WHERE joined.participant_id = participant.id
                AND joined.event_type = 'forum.joined') AS joined_at,
            signal_counts.need_count, signal_counts.can_count,
            signal_counts.want_count, signal_counts.have_count
       FROM participants participant
       LEFT JOIN external_identities telegram
         ON telegram.participant_id = participant.id
        AND telegram.provider = 'telegram'
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE signal.kind = 'need')::integer AS need_count,
                count(*) FILTER (WHERE signal.kind = 'can')::integer AS can_count,
                count(*) FILTER (WHERE signal.kind = 'want')::integer AS want_count,
                count(*) FILTER (WHERE signal.kind = 'have')::integer AS have_count
           FROM profile_signals signal
          WHERE signal.participant_id = participant.id
            AND signal.status = 'active'
            AND signal.visibility <> 'network_blind'
            AND (signal.visibility IN ('public', 'members') OR participant.id = $3::uuid)
       ) signal_counts ON true
      WHERE (
        EXISTS (
          SELECT 1 FROM participant_forum_onboarding forum
           WHERE forum.participant_id = participant.id
             AND forum.forum_status = 'joined'
        )
        OR EXISTS (
          SELECT 1 FROM events login
           WHERE login.participant_id = participant.id
             AND login.event_type = 'participant.logged_in'
        )
      )
        ${coreOnly}
        ${filters.withoutResidence ? `AND NULLIF(btrim(participant.residence_name), '') IS NULL` : ""}
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
            lower(btrim(participant.residence_name)) = $4
          )
        )
      ORDER BY ${orderBy}lower(participant.display_name), participant.id`,
    [normalizedSearch, normalizedInterest, filters.viewerParticipantId ?? null,
      residence?.name.trim().toLocaleLowerCase("ru-RU") ?? ""],
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
    signalCounts: {
      need: Number(row.need_count ?? 0), can: Number(row.can_count ?? 0),
      want: Number(row.want_count ?? 0), have: Number(row.have_count ?? 0),
    },
    joinedAt: row.joined_at ? new Date(String(row.joined_at)) : null,
    residence: typeof row.residence_name === "string" && row.residence_name.trim()
      ? { name: row.residence_name }
      : null,
    profileAge: row.profile_age === null || row.profile_age === undefined ? null : Number(row.profile_age),
    profileCity: row.profile_city ? String(row.profile_city) : null,
    profileOccupation: row.profile_occupation ? String(row.profile_occupation) : null,
    profileEducation: row.profile_education ? String(row.profile_education) : null,
    profileFamilyStatus: row.profile_family_status ? String(row.profile_family_status) : null,
  }));
}

export async function listParticipantsDirectory(
  search = "",
  filters: DirectoryFilters = {},
) {
  const { pool } = await import("./db");
  return listParticipantsDirectoryWithDatabase(pool, search, filters);
}
