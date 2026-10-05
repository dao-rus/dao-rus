WITH bindings AS (
  SELECT participant_id, external_user_id AS telegram_user_id,
         'external_identities.external_user_id' AS source, updated_at AS observed_at
    FROM external_identities WHERE provider = 'telegram'
  UNION ALL
  SELECT participant_id, telegram_user_id::text, 'telegram_roster_entries.telegram_user_id', observed_at
    FROM telegram_roster_entries WHERE participant_id IS NOT NULL
  UNION ALL
  SELECT participant_id, payload->>'telegram_user_id', 'events:' || id || ':' || event_type, created_at
    FROM events WHERE participant_id IS NOT NULL AND
      (event_type = 'telegram.message_created' OR
       (event_type = 'participant.created' AND payload->>'source' = 'participant_registry') OR
       (event_type IN ('membership.joined', 'membership.left', 'membership.rejoined', 'membership.excluded', 'membership.restored')
        AND payload->>'participant_id' = participant_id::text))
), aliases AS (
  SELECT participant_id, 'telegram_user_id' AS kind, telegram_user_id AS value, source, observed_at
    FROM bindings WHERE telegram_user_id ~ '^[1-9][0-9]*$'
  UNION ALL
  SELECT e.participant_id, alias.kind, alias.value, 'external_identities.' || alias.field, e.updated_at
    FROM external_identities e CROSS JOIN LATERAL (VALUES
      ('username', e.username, 'username'),
      ('display_name', nullif(concat_ws(' ', e.first_name, e.last_name), ''), 'first_name+last_name'),
      ('username', e.bot_profile->>'username', 'bot_profile.username'),
      ('display_name', nullif(concat_ws(' ', e.bot_profile->>'first_name', e.bot_profile->>'last_name'), ''), 'bot_profile.first_name+last_name'),
      ('username', e.oidc_profile->>'preferred_username', 'oidc_profile.preferred_username'),
      ('display_name', e.oidc_profile->>'name', 'oidc_profile.name'),
      ('display_name', nullif(concat_ws(' ', e.oidc_profile->>'given_name', e.oidc_profile->>'family_name'), ''), 'oidc_profile.given_name+family_name')
    ) alias(kind, value, field)
    WHERE e.provider = 'telegram'
      AND (alias.field NOT LIKE 'bot_profile.%' OR e.bot_profile->>'id' IS NULL OR e.bot_profile->>'id' = e.external_user_id)
  UNION ALL
  SELECT r.participant_id, alias.kind, alias.value, 'telegram_roster_entries.' || alias.field, r.observed_at
    FROM telegram_roster_entries r CROSS JOIN LATERAL (VALUES
      ('username', r.username, 'username'), ('display_name', r.display_name, 'display_name')
    ) alias(kind, value, field) WHERE r.participant_id IS NOT NULL
  UNION ALL
  SELECT participant_id, 'username', payload->>'username', 'events:' || id || ':telegram.message_created.username', created_at
    FROM events WHERE event_type = 'telegram.message_created' AND participant_id IS NOT NULL
  UNION ALL
  SELECT e.participant_id, 'display_name', alias.value, 'events:' || e.id || ':participant.profile_updated.' || alias.field, e.created_at
    FROM events e CROSS JOIN LATERAL (VALUES
      (e.payload->>'old_display_name', 'old_display_name'), (e.payload->>'new_display_name', 'new_display_name')
    ) alias(value, field) WHERE e.event_type = 'participant.profile_updated' AND e.participant_id IS NOT NULL
), valid_aliases AS (
  SELECT DISTINCT participant_id, kind, value, source, observed_at FROM aliases WHERE value IS NOT NULL AND btrim(value) <> ''
)
SELECT p.id, p.display_name,
       coalesce((SELECT array_agg(DISTINCT ev.payload->>'archived_username') FROM events ev
         WHERE ev.participant_id = p.id AND ev.payload->>'source' = 'admin_archive_reconstruction'
           AND ev.payload->>'source_channel' = '@list_of_exites'
           AND ev.event_type = 'participant.created'), ARRAY[]::text[]) AS reconstructed_archived_usernames,
       (SELECT external_user_id FROM external_identities WHERE participant_id = p.id AND provider = 'telegram') AS telegram_user_id,
       coalesce(array_agg(DISTINCT a.value) FILTER (WHERE a.kind = 'telegram_user_id'), ARRAY[]::text[]) AS telegram_user_ids,
       coalesce(array_agg(DISTINCT a.value) FILTER (WHERE a.kind = 'username' AND a.source = 'external_identities.username'), ARRAY[]::text[]) AS usernames,
       coalesce(array_agg(DISTINCT a.value) FILTER (WHERE a.kind = 'username' AND a.source <> 'external_identities.username'), ARRAY[]::text[]) AS historical_usernames,
       coalesce(array_agg(DISTINCT a.value) FILTER (WHERE a.kind = 'display_name'), ARRAY[]::text[]) AS historical_display_names,
       coalesce(jsonb_agg(jsonb_build_object('kind', a.kind, 'value', a.value, 'source', a.source, 'observed_at', a.observed_at)) FILTER (WHERE a.value IS NOT NULL), '[]'::jsonb) AS identity_evidence
  FROM participants p LEFT JOIN valid_aliases a ON a.participant_id = p.id
 GROUP BY p.id, p.display_name ORDER BY p.id
