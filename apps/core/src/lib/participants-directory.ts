import { VERIFIED_SUBJECTS_CTE } from "./verification";

export type ParticipantDirectoryEntry = {
  participantId: string;
  displayName: string;
  telegramUsername: string | null;
  telegramBio: string | null;
  avatarUrl: string | null;
  hasTelegramPhoto: boolean;
  isVerified: boolean;
};

type QueryResult = {
  rows: Array<Record<string, unknown>>;
};

export type ParticipantDirectoryDatabase = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

export async function listParticipantsDirectoryWithDatabase(
  database: ParticipantDirectoryDatabase,
  search = "",
): Promise<ParticipantDirectoryEntry[]> {
  const normalizedSearch = search.trim().replace(/^@+/, "");
  const result = await database.query(
    `${VERIFIED_SUBJECTS_CTE}
     SELECT participant.id AS participant_id,
            participant.display_name,
            telegram.username AS telegram_username,
            telegram.bot_profile->>'bio' AS telegram_bio,
            telegram.avatar_url,
            telegram.bot_profile->'photo'->>'file_id' AS telegram_photo_file_id,
            telegram.bot_profile->>'photo_count' AS telegram_photo_count,
            EXISTS (
              SELECT 1 FROM verified
               WHERE verified.subject_id = participant.id
            ) AS is_verified
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
      ORDER BY lower(participant.display_name), participant.id`,
    [normalizedSearch],
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
    isVerified: Boolean(row.is_verified),
  }));
}

export async function listParticipantsDirectory(search = "") {
  const { pool } = await import("./db");
  return listParticipantsDirectoryWithDatabase(pool, search);
}
