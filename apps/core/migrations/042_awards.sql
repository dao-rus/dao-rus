-- Awards are recognition, independent of DARUS, verification and reputation.
CREATE TABLE awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 100),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  image_url text NOT NULL CHECK (length(btrim(image_url)) BETWEEN 1 AND 2048),
  established_on date NOT NULL,
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 10000),
  criterion text NOT NULL CHECK (length(btrim(criterion)) BETWEEN 1 AND 10000),
  public_address text NOT NULL CHECK (length(btrim(public_address)) BETWEEN 1 AND 10000),
  kind text NOT NULL CHECK (kind IN ('historical', 'open')),
  historical_cutoff_at timestamptz,
  founder_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  charter_version integer NOT NULL CHECK (charter_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (kind = 'historical' OR historical_cutoff_at IS NULL)
);

CREATE TABLE award_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  award_id uuid NOT NULL REFERENCES awards(id) ON DELETE RESTRICT,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  awarded_by_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  personal_address text NOT NULL DEFAULT '' CHECK (length(personal_address) <= 10000),
  status text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered', 'declined', 'accepted', 'rejected')),
  offered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  declined_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  show_in_public_list boolean NOT NULL DEFAULT false,
  show_next_to_name boolean NOT NULL DEFAULT false,
  UNIQUE (award_id, participant_id),
  CHECK (declined_at IS NULL OR declined_at >= offered_at),
  CHECK (accepted_at IS NULL OR accepted_at >= COALESCE(declined_at, offered_at)),
  CHECK (rejected_at IS NULL OR rejected_at >= accepted_at),
  CHECK (
    (status = 'offered' AND declined_at IS NULL AND accepted_at IS NULL AND rejected_at IS NULL)
    OR (status = 'declined' AND declined_at IS NOT NULL AND accepted_at IS NULL AND rejected_at IS NULL)
    OR (status = 'accepted' AND accepted_at IS NOT NULL AND rejected_at IS NULL)
    OR (status = 'rejected' AND accepted_at IS NOT NULL AND rejected_at IS NOT NULL)
  )
);

CREATE INDEX award_instances_participant_idx ON award_instances(participant_id);

-- No ordinary edits/deletions of established awards or issued instance content.
CREATE FUNCTION protect_award_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Established awards are immutable';
END;
$$;
CREATE TRIGGER awards_protect_history BEFORE UPDATE OR DELETE ON awards
  FOR EACH ROW EXECUTE FUNCTION protect_award_definition();

CREATE FUNCTION protect_award_instance_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Award instance history cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'offered' OR NEW.declined_at IS NOT NULL
       OR NEW.accepted_at IS NOT NULL OR NEW.rejected_at IS NOT NULL
       OR NEW.show_in_public_list OR NEW.show_next_to_name THEN
      RAISE EXCEPTION 'An award instance must start as a private offer';
    END IF;
    -- Historical eligibility never backdates an actual offer.
    NEW.offered_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF ROW(NEW.id, NEW.award_id, NEW.participant_id, NEW.awarded_by_participant_id,
         NEW.reason, NEW.personal_address, NEW.offered_at,
         NEW.declined_at, NEW.accepted_at, NEW.rejected_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.award_id, OLD.participant_id, OLD.awarded_by_participant_id,
         OLD.reason, OLD.personal_address, OLD.offered_at,
         OLD.declined_at, OLD.accepted_at, OLD.rejected_at) THEN
    RAISE EXCEPTION 'Award instance content and recorded dates are immutable';
  END IF;
  IF ROW(NEW.show_in_public_list, NEW.show_next_to_name)
     IS DISTINCT FROM ROW(OLD.show_in_public_list, OLD.show_next_to_name)
     AND (OLD.status <> 'accepted' OR NEW.status <> 'accepted') THEN
    RAISE EXCEPTION 'Award visibility can change only while accepted';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'offered' AND NEW.status = 'declined' THEN
      NEW.declined_at := clock_timestamp();
    ELSIF OLD.status IN ('offered', 'declined') AND NEW.status = 'accepted' THEN
      NEW.accepted_at := clock_timestamp();
    ELSIF OLD.status = 'accepted' AND NEW.status = 'rejected' THEN
      NEW.rejected_at := clock_timestamp();
    ELSE
      RAISE EXCEPTION 'Invalid award instance transition: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER award_instances_protect_history BEFORE INSERT OR UPDATE OR DELETE ON award_instances
  FOR EACH ROW EXECUTE FUNCTION protect_award_instance_history();

-- Events share the mutation transaction, including direct SQL writers.
CREATE FUNCTION record_award_established() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO events(event_type, participant_id, payload, created_at)
  VALUES ('award.established', NEW.founder_participant_id,
    jsonb_build_object('award_id', NEW.id, 'charter_version', NEW.charter_version,
      'founder_participant_id', NEW.founder_participant_id), NEW.created_at);
  RETURN NEW;
END;
$$;
CREATE TRIGGER awards_record_event AFTER INSERT ON awards
  FOR EACH ROW EXECUTE FUNCTION record_award_established();

CREATE FUNCTION record_award_instance_action() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  action_type text;
  actor_id uuid;
  action_at timestamptz;
  action_payload jsonb;
BEGIN
  action_payload := jsonb_build_object('award_id', NEW.award_id, 'instance_id', NEW.id,
    'recipient_participant_id', NEW.participant_id,
    'awarded_by_participant_id', NEW.awarded_by_participant_id);
  IF TG_OP = 'INSERT' THEN
    action_type := 'award.offered';
    actor_id := NEW.awarded_by_participant_id;
    action_at := NEW.offered_at;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    action_type := 'award.' || NEW.status;
    actor_id := NEW.participant_id;
    action_at := CASE NEW.status WHEN 'declined' THEN NEW.declined_at
      WHEN 'accepted' THEN NEW.accepted_at WHEN 'rejected' THEN NEW.rejected_at END;
    action_payload := action_payload || jsonb_build_object('previous_status', OLD.status);
  ELSIF ROW(NEW.show_in_public_list, NEW.show_next_to_name)
        IS DISTINCT FROM ROW(OLD.show_in_public_list, OLD.show_next_to_name) THEN
    action_type := 'award.visibility_changed';
    actor_id := NEW.participant_id;
    action_at := clock_timestamp();
    action_payload := action_payload || jsonb_build_object(
      'show_in_public_list', NEW.show_in_public_list, 'show_next_to_name', NEW.show_next_to_name);
  ELSE
    RETURN NEW;
  END IF;
  INSERT INTO events(event_type, participant_id, payload, created_at)
  VALUES (action_type, actor_id, action_payload, action_at);
  RETURN NEW;
END;
$$;
CREATE TRIGGER award_instances_record_event AFTER INSERT OR UPDATE ON award_instances
  FOR EACH ROW EXECUTE FUNCTION record_award_instance_action();
