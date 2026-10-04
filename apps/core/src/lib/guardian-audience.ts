import type { Residence } from "./profile-about";

type QueryResult = { rows: Array<Record<string, unknown>> };
export type GuardianAudienceDatabase = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

export type GuardianParticipant = {
  id: string;
  displayName: string;
  telegramUsername: string | null;
  hasTelegramUserId: boolean;
  residence: Residence | null;
  interests: Array<{ key: string; label: string }>;
};

export type GuardianFilters = { city?: string; interests?: string[] };

export function cityKey(residence: Residence): string {
  return JSON.stringify([residence.name, residence.type, residence.country]
    .map((part) => part.trim().toLocaleLowerCase("ru-RU")));
}

export async function getGuardianAudienceWithDatabase(
  database: GuardianAudienceDatabase,
  filters: GuardianFilters = {},
) {
  const result = await database.query(
    `SELECT p.id, p.display_name, p.membership_status,
            p.residence_name, p.residence_type, p.residence_country,
            telegram.username AS telegram_username,
            (telegram.external_user_id IS NOT NULL AND btrim(telegram.external_user_id) <> '') AS has_telegram_user_id,
            EXISTS (
              SELECT 1 FROM participant_forum_onboarding forum
               WHERE forum.participant_id = p.id AND forum.forum_status = 'joined'
            ) AS forum_joined,
            EXISTS (
              SELECT 1 FROM events login
               WHERE login.participant_id = p.id AND login.event_type = 'participant.logged_in'
            ) AS logged_in,
            EXISTS (
              SELECT 1 FROM telegram_roster_entries roster
               WHERE roster.participant_id = p.id
                 AND (roster.is_bot OR roster.membership_status = 'bot')
            ) AS is_bot,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object('key', interest.normalized_label, 'label', interest.label)
                               ORDER BY interest.label)
                FROM participant_interests interest
               WHERE interest.participant_id = p.id
            ), '[]'::jsonb) AS interests
       FROM participants p
       LEFT JOIN external_identities telegram
         ON telegram.participant_id = p.id AND telegram.provider = 'telegram'
      ORDER BY lower(p.display_name), p.id`,
  );

  const participants: GuardianParticipant[] = result.rows
    .filter((row) => (row.forum_joined === true || row.logged_in === true)
      && row.membership_status !== "left"
      && row.membership_status !== "excluded"
      && row.is_bot !== true)
    .map((row) => ({
      id: String(row.id),
      displayName: String(row.display_name),
      telegramUsername: row.telegram_username ? String(row.telegram_username) : null,
      hasTelegramUserId: row.has_telegram_user_id === true,
      residence: row.residence_name && row.residence_type && row.residence_country
        ? {
            name: String(row.residence_name),
            type: String(row.residence_type),
            country: String(row.residence_country),
          }
        : null,
      interests: (row.interests as Array<{ key: string; label: string }> | null) ?? [],
    }));

  const cities = [...new Map(participants.flatMap((person) => person.residence
    ? [[cityKey(person.residence), person.residence] as const] : [])).entries()]
    .map(([key, residence]) => ({ key, residence }))
    .sort((a, b) => a.residence.name.localeCompare(b.residence.name, "ru"));
  const interests = [...new Map(participants.flatMap((person) => person.interests
    .map((interest) => [interest.key, interest.label] as const))).entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));

  const selectedInterests = new Set(filters.interests ?? []);
  const audience = participants.filter((person) =>
    (!filters.city || (person.residence !== null && cityKey(person.residence) === filters.city))
    && (selectedInterests.size === 0 || person.interests.some((interest) => selectedInterests.has(interest.key))));

  return {
    missingCity: participants.filter((person) => person.residence === null),
    missingInterests: participants.filter((person) => person.interests.length === 0),
    cities,
    interests,
    audience,
  };
}

export async function getGuardianAudience(filters: GuardianFilters = {}) {
  const { pool } = await import("./db");
  return getGuardianAudienceWithDatabase(pool, filters);
}
