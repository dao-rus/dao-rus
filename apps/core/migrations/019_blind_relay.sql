ALTER TABLE profile_signals
  DROP CONSTRAINT profile_signals_visibility_check,
  ADD CONSTRAINT profile_signals_visibility_check
    CHECK (visibility IN ('public', 'members', 'circle', 'match_only', 'private', 'network_blind')),
  ADD CONSTRAINT profile_signals_blind_kind_check
    CHECK (visibility <> 'network_blind' OR kind IN ('need', 'have'));

CREATE INDEX profile_signals_blind_catalog_idx
  ON profile_signals(kind, created_at DESC, id DESC)
  WHERE visibility = 'network_blind' AND status = 'active';

CREATE TABLE relay_encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES profile_signals(id),
  author_id uuid NOT NULL REFERENCES participants(id),
  responder_id uuid NOT NULL REFERENCES participants(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revealed', 'cancelled')),
  author_consented_at timestamptz,
  responder_consented_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (author_id <> responder_id),
  CHECK (status <> 'revealed' OR (author_consented_at IS NOT NULL AND responder_consented_at IS NOT NULL))
);

CREATE INDEX relay_encounters_author_idx
  ON relay_encounters(author_id, status, created_at DESC);
CREATE INDEX relay_encounters_responder_idx
  ON relay_encounters(responder_id, status, created_at DESC);

CREATE TABLE relay_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES relay_encounters(id),
  sender_id uuid NOT NULL REFERENCES participants(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX relay_messages_encounter_idx
  ON relay_messages(encounter_id, created_at, id);
