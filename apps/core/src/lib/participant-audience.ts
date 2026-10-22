import { residenceKey, type Residence } from "./profile-about";
import { VERIFIED_SUBJECTS_CTE } from "./verification";

type QueryResult = { rows: Array<Record<string, unknown>> };
export type ParticipantAudienceDatabase = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

export type AudienceParticipant = {
  id: string;
  displayName: string;
  telegramUsername: string | null;
  hasTelegramUserId: boolean;
  residence: Residence | null;
  interests: Array<{ key: string; label: string }>;
  joinedOn?: string | null;
  joinedSource?: string | null;
  joinedApproximate?: boolean;
};

export const audienceConditions = ["without_residence", "without_interests", "without_bio", "without_want", "without_need", "without_can", "without_have", "never_logged_in", "unverified"] as const;
export type AudienceCondition = typeof audienceConditions[number];
export type AudienceFilters = { city?: string; interests?: string[]; conditions?: AudienceCondition[]; membership?: string; verification?: string; joinedFrom?: string; joinedTo?: string };

export function cityKey(residence: Residence): string {
  return residenceKey(residence);
}

// Saved audience rules used [name, type, country]. Keep those rules readable.
export function normalizeAudienceCityKey(value: string): string {
  if (value.startsWith("[")) {
    try {
      const legacy = JSON.parse(value);
      if (Array.isArray(legacy) && legacy.length === 3 && typeof legacy[0] === "string") {
        return residenceKey({ name: legacy[0] });
      }
    } catch { /* A non-legacy name is matched literally. */ }
  }
  return residenceKey({ name: value });
}

export async function selectParticipantAudienceWithDatabase(
  database: ParticipantAudienceDatabase,
  filters: AudienceFilters = {}, scope: "guardian" | "awards" = "guardian",
) {
  const result = await database.query(
    `${VERIFIED_SUBJECTS_CTE}
     SELECT p.id, p.display_name, p.membership_status,
            ${scope === "awards" ? "join_history.joined_on, join_history.joined_source, join_history.joined_approximate," : ""}
            btrim(p.profile_bio) <> '' AS has_bio,
            EXISTS (SELECT 1 FROM verified WHERE subject_id = p.id) AS is_verified,
            ARRAY(SELECT DISTINCT kind FROM profile_signals WHERE participant_id = p.id AND status = 'active') AS active_signal_kinds,
            p.residence_name,
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
            EXISTS (
              SELECT 1 FROM participant_interests any_interest
               WHERE any_interest.participant_id = p.id
            ) AS has_any_interests,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object('key', interest.normalized_label, 'label', interest.label)
                               ORDER BY interest.label)
                FROM participant_interests interest
               WHERE interest.participant_id = p.id
                 AND interest.visibility IN ('public', 'members')
            ), '[]'::jsonb) AS interests
       FROM participants p
       LEFT JOIN external_identities telegram
         ON telegram.participant_id = p.id AND telegram.provider = 'telegram'
       ${scope === "awards" ? `LEFT JOIN LATERAL (
         SELECT (COALESCE((e.payload->>'observed_at')::timestamptz, e.created_at)
                 AT TIME ZONE 'Europe/Moscow')::date::text AS joined_on,
                e.payload->>'source' AS joined_source,
                e.payload->>'approximate' = 'true' AS joined_approximate
           FROM events e WHERE e.participant_id = p.id AND e.event_type = 'forum.joined'
             AND e.payload->>'source' IN ('telegram_export', 'chat_member')
          ORDER BY COALESCE((e.payload->>'observed_at')::timestamptz, e.created_at), e.id LIMIT 1
       ) join_history ON true` : ""}
      ORDER BY lower(p.display_name), p.id`,
  );

  const participants = result.rows
    .filter((row) => (scope === "awards" || row.forum_joined === true || row.logged_in === true)
      && (scope === "awards" || row.membership_status !== "left")
      && (scope === "awards" || row.membership_status !== "excluded")
      && row.is_bot !== true)
    .map((row) => ({
      id: String(row.id),
      displayName: String(row.display_name), membership: String(row.membership_status),
      telegramUsername: row.telegram_username ? String(row.telegram_username) : null,
      hasTelegramUserId: row.has_telegram_user_id === true,
      residence: typeof row.residence_name === "string" && row.residence_name.trim()
        ? { name: row.residence_name }
        : null,
      interests: (row.interests as Array<{ key: string; label: string }> | null) ?? [],
      hasAnyInterests: row.has_any_interests === true,
      hasBio: row.has_bio === true,
      loggedIn: row.logged_in === true,
      verified: row.is_verified === true,
      activeSignalKinds: (row.active_signal_kinds as string[] | null) ?? [],
      ...(scope === "awards" ? {
        joinedOn: row.joined_on ? String(row.joined_on) : null,
        joinedSource: row.joined_source ? String(row.joined_source) : null,
        joinedApproximate: row.joined_approximate === true,
      } : {}),
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
  const matches = (person: typeof participants[number], condition: AudienceCondition) => {
    if (condition === "without_residence") return person.residence === null;
    if (condition === "without_interests") return !person.hasAnyInterests;
    if (condition === "without_bio") return !person.hasBio;
    if (condition === "never_logged_in") return !person.loggedIn;
    if (condition === "unverified") return !person.verified;
    return !person.activeSignalKinds.includes(condition.slice("without_".length));
  };
  const matchingProfiles = participants.filter((person) =>
    (!filters.membership || person.membership === filters.membership) && (!filters.verification || person.verified === (filters.verification === "verified")) && (!filters.city || (person.residence !== null && cityKey(person.residence) === normalizeAudienceCityKey(filters.city)))
    && (selectedInterests.size === 0 || person.interests.some((interest) => selectedInterests.has(interest.key)))
    && (filters.conditions ?? []).every(condition => matches(person, condition)));

  const dateFilter = scope === "awards" && Boolean(filters.joinedFrom || filters.joinedTo);
  const byName = (a: typeof participants[number], b: typeof participants[number]) =>
    a.displayName.localeCompare(b.displayName, "ru") || a.id.localeCompare(b.id);
  const audience = matchingProfiles.filter(person => !dateFilter || (person.joinedOn != null
    && (!filters.joinedFrom || person.joinedOn >= filters.joinedFrom)
    && (!filters.joinedTo || person.joinedOn <= filters.joinedTo)));
  if (dateFilter) audience.sort((a, b) => (a.joinedOn ?? "9999").localeCompare(b.joinedOn ?? "9999") || byName(a, b));
  // Unknown evidence is shown for manual review, never authorized as a range match.
  const unknownDates = dateFilter ? matchingProfiles.filter(person => person.joinedOn == null).sort(byName) : [];

  return {
    missingCity: participants.filter((person) => person.residence === null),
    missingInterests: participants.filter((person) => !person.hasAnyInterests),
    missingBio: participants.filter(person => !person.hasBio),
    neverLoggedIn: participants.filter(person => !person.loggedIn),
    unverified: participants.filter(person => !person.verified),
    cities,
    interests,
    audience,
    unknownDates,
  };
}
