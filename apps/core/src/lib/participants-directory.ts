import { VERIFIED_SUBJECTS_CTE } from "./verification";

export type ParticipantDirectoryEntry = {
  participantId: string;
  displayName: string;
  telegramUsername: string | null;
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
            EXISTS (
              SELECT 1 FROM verified
               WHERE verified.subject_id = participant.id
            ) AS is_verified
       FROM participants participant
       LEFT JOIN external_identities telegram
         ON telegram.participant_id = participant.id
        AND telegram.provider = 'telegram'
      WHERE $1::text = ''
         OR participant.display_name ILIKE '%' || $1 || '%'
         OR COALESCE(telegram.username, '') ILIKE '%' || $1 || '%'
      ORDER BY lower(participant.display_name), participant.id`,
    [normalizedSearch],
  );

  return result.rows.map((row) => ({
    participantId: String(row.participant_id),
    displayName: String(row.display_name),
    telegramUsername: row.telegram_username
      ? String(row.telegram_username)
      : null,
    isVerified: Boolean(row.is_verified),
  }));
}

export async function listParticipantsDirectory(search = "") {
  const { pool } = await import("./db");
  return listParticipantsDirectoryWithDatabase(pool, search);
}
