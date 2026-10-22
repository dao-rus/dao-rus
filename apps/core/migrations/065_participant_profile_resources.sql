CREATE TABLE participant_profile_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  url text NOT NULL CHECK (char_length(url) BETWEEN 1 AND 2048),
  normalized_url text NOT NULL CHECK (char_length(normalized_url) BETWEEN 1 AND 2048),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, normalized_url)
);

CREATE INDEX participant_profile_resources_participant_idx
  ON participant_profile_resources(participant_id, created_at, id);
