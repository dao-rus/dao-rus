ALTER TABLE profile_signals
  ADD COLUMN external_share_enabled boolean NOT NULL DEFAULT false;

-- Older adapters may update visibility or status directly. Never carry external
-- consent across a change that makes the Signal unavailable to guests.
CREATE FUNCTION clear_signal_external_share() RETURNS trigger AS $$
BEGIN
  IF NEW.visibility <> 'public' OR NEW.status <> 'active' THEN
    NEW.external_share_enabled := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profile_signal_clear_external_share
  BEFORE INSERT OR UPDATE ON profile_signals
  FOR EACH ROW EXECUTE FUNCTION clear_signal_external_share();

CREATE TABLE signal_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES profile_signals(id) ON DELETE RESTRICT,
  actor_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX signal_reactions_one_active_idx
  ON signal_reactions(signal_id, actor_participant_id) WHERE revoked_at IS NULL;
CREATE INDEX signal_reactions_active_count_idx
  ON signal_reactions(signal_id) WHERE revoked_at IS NULL;

CREATE FUNCTION guard_signal_reaction() RETURNS trigger AS $$
DECLARE owner_id uuid;
BEGIN
  SELECT participant_id INTO owner_id FROM profile_signals
    WHERE id = NEW.signal_id AND status = 'active'
      AND visibility IN ('public', 'members', 'network_blind') FOR SHARE;
  IF NOT FOUND OR owner_id = NEW.actor_participant_id THEN
    RAISE EXCEPTION 'Signal reaction is unavailable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER signal_reactions_insert_guard
  BEFORE INSERT ON signal_reactions
  FOR EACH ROW EXECUTE FUNCTION guard_signal_reaction();

CREATE FUNCTION protect_signal_reaction_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Signal reaction history cannot be deleted';
  END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.signal_id IS DISTINCT FROM OLD.signal_id
     OR NEW.actor_participant_id IS DISTINCT FROM OLD.actor_participant_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'Only revocation of an active Signal reaction is allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER signal_reactions_protect_history
  BEFORE UPDATE OR DELETE ON signal_reactions
  FOR EACH ROW EXECUTE FUNCTION protect_signal_reaction_history();
