CREATE TABLE reputation_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  subject_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  dimension text NOT NULL CHECK (dimension = 'interaction_quality'),
  signal_type text NOT NULL CHECK (signal_type IN ('positive', 'quality_flag')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (actor_participant_id <> subject_participant_id),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX reputation_signals_one_active_idx
  ON reputation_signals(actor_participant_id, subject_participant_id, dimension)
  WHERE revoked_at IS NULL;

CREATE INDEX reputation_signals_positive_subject_idx
  ON reputation_signals(subject_participant_id)
  WHERE dimension = 'interaction_quality' AND signal_type = 'positive' AND revoked_at IS NULL;

CREATE INDEX reputation_signals_history_idx
  ON reputation_signals(created_at DESC, id DESC);

CREATE FUNCTION protect_reputation_signal_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Reputation signal history cannot be deleted';
  END IF;
  IF OLD.revoked_at IS NOT NULL
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.actor_participant_id IS DISTINCT FROM OLD.actor_participant_id
     OR NEW.subject_participant_id IS DISTINCT FROM OLD.subject_participant_id
     OR NEW.dimension IS DISTINCT FROM OLD.dimension
     OR NEW.signal_type IS DISTINCT FROM OLD.signal_type
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'Only revocation of an active reputation signal is allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reputation_signals_protect_history
  BEFORE UPDATE OR DELETE ON reputation_signals
  FOR EACH ROW EXECUTE FUNCTION protect_reputation_signal_history();
