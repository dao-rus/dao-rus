ALTER TABLE participants
  ADD COLUMN profile_bio text NOT NULL DEFAULT '',
  ADD COLUMN profile_bio_visibility text NOT NULL DEFAULT 'members'
    CHECK (profile_bio_visibility IN ('public', 'members', 'circle', 'match_only', 'private'));

CREATE TABLE participant_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  label text NOT NULL,
  normalized_label text NOT NULL,
  visibility text NOT NULL DEFAULT 'members'
    CHECK (visibility IN ('public', 'members', 'circle', 'match_only', 'private')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, normalized_label)
);

CREATE INDEX participant_interests_participant_idx
  ON participant_interests(participant_id, created_at);

CREATE TABLE profile_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  kind text NOT NULL
    CHECK (kind IN ('want', 'need', 'can', 'have')),
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'members'
    CHECK (visibility IN ('public', 'members', 'circle', 'match_only', 'private')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profile_signals_participant_status_idx
  ON profile_signals(participant_id, status, created_at DESC);
