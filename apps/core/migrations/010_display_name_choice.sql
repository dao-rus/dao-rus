ALTER TABLE participants
  ADD COLUMN display_name_chosen_in_core boolean NOT NULL DEFAULT false;

UPDATE participants p
   SET display_name_chosen_in_core = true
 WHERE EXISTS (
   SELECT 1 FROM events e
    WHERE e.participant_id = p.id
      AND e.event_type = 'participant.profile_updated'
 );

UPDATE participants p
   SET display_name = COALESCE(
         NULLIF(btrim(concat_ws(' ', e.first_name, e.last_name)), ''),
         NULLIF(btrim(e.username), ''),
         p.display_name
       ),
       updated_at = now()
  FROM external_identities e
 WHERE e.participant_id = p.id
   AND e.provider = 'telegram'
   AND e.provider_subject NOT LIKE 'roster:%'
   AND NOT p.display_name_chosen_in_core
   AND EXISTS (
     SELECT 1 FROM events login
      WHERE login.participant_id = p.id
        AND login.event_type = 'participant.logged_in'
   );
