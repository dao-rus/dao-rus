-- Draft snapshots and atomic releases; existing instances retain their history.
ALTER TABLE awards ADD COLUMN image_data bytea, ADD COLUMN thumbnail_data bytea;
ALTER TABLE awards ADD CONSTRAINT awards_image_pair CHECK (
  (image_data IS NULL AND thumbnail_data IS NULL) OR
  (image_data IS NOT NULL AND thumbnail_data IS NOT NULL AND octet_length(image_data) BETWEEN 1 AND 5242880 AND octet_length(thumbnail_data) BETWEEN 1 AND 65536));

CREATE TABLE award_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  award_id uuid NOT NULL REFERENCES awards(id) ON DELETE RESTRICT,
  created_by_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('regular', 'remint')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  audience_rule jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalized_at timestamptz,
  finalized_by_participant_id uuid REFERENCES participants(id) ON DELETE RESTRICT,
  CHECK ((status = 'draft' AND finalized_at IS NULL AND finalized_by_participant_id IS NULL)
    OR (status = 'finalized' AND finalized_at >= created_at AND finalized_by_participant_id IS NOT NULL))
);
CREATE TABLE award_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES award_batches(id) ON DELETE RESTRICT,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('filter', 'manual')),
  status text NOT NULL DEFAULT 'included' CHECK (status IN ('included', 'excluded')),
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 2000),
  personal_address text NOT NULL DEFAULT '' CHECK (length(personal_address) <= 10000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (batch_id, participant_id)
);
ALTER TABLE award_instances ADD COLUMN batch_id uuid REFERENCES award_batches(id) ON DELETE RESTRICT;
CREATE INDEX award_batches_award_idx ON award_batches(award_id);
CREATE INDEX award_instances_batch_idx ON award_instances(batch_id) WHERE batch_id IS NOT NULL;

CREATE FUNCTION protect_award_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Batch history cannot be deleted'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'Batch must start as draft'; END IF;
    IF NEW.kind = 'remint' AND NOT EXISTS (SELECT 1 FROM awards WHERE id=NEW.award_id AND kind='historical') THEN
      RAISE EXCEPTION 'Only historical awards allow remint';
    END IF;
    NEW.created_at := clock_timestamp();
  ELSE
    IF OLD.status = 'finalized' OR ROW(NEW.id,NEW.award_id,NEW.created_by_participant_id,NEW.kind,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.award_id,OLD.created_by_participant_id,OLD.kind,OLD.created_at) THEN
      RAISE EXCEPTION 'Batch history is immutable';
    END IF;
    IF NEW.status = 'finalized' THEN
      IF NEW.audience_rule IS DISTINCT FROM OLD.audience_rule THEN RAISE EXCEPTION 'Cannot change snapshot during finalization'; END IF;
      IF NOT EXISTS (SELECT 1 FROM award_candidates WHERE batch_id=NEW.id AND status='included') OR EXISTS (
        SELECT 1 FROM award_candidates c WHERE c.batch_id=NEW.id AND c.status='included' AND NOT EXISTS (
          SELECT 1 FROM award_instances i WHERE i.batch_id=NEW.id AND i.award_id=NEW.award_id
            AND i.participant_id=c.participant_id AND i.reason=c.reason AND i.personal_address=c.personal_address
            AND i.awarded_by_participant_id=NEW.finalized_by_participant_id)) THEN
        RAISE EXCEPTION 'All included candidates must have matching offers';
      END IF;
      IF EXISTS (SELECT 1 FROM award_instances i WHERE i.batch_id=NEW.id AND NOT EXISTS (
        SELECT 1 FROM award_candidates c WHERE c.batch_id=NEW.id AND c.participant_id=i.participant_id
          AND c.status='included' AND c.reason=i.reason AND c.personal_address=i.personal_address
          AND i.award_id=NEW.award_id AND i.awarded_by_participant_id=NEW.finalized_by_participant_id)) THEN
        RAISE EXCEPTION 'Release must contain exactly the included candidates';
      END IF;
      NEW.finalized_at := clock_timestamp();
    ELSIF ROW(NEW.finalized_at,NEW.finalized_by_participant_id) IS DISTINCT FROM ROW(OLD.finalized_at,OLD.finalized_by_participant_id) THEN
      RAISE EXCEPTION 'Draft cannot have finalization history';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER award_batches_protect BEFORE INSERT OR UPDATE OR DELETE ON award_batches
  FOR EACH ROW EXECUTE FUNCTION protect_award_batch();

CREATE FUNCTION protect_award_candidate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_status text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Exclude candidates instead of deleting'; END IF;
  SELECT status INTO batch_status FROM award_batches WHERE id=NEW.batch_id FOR UPDATE;
  IF batch_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'Finalized candidates are immutable'; END IF;
  IF TG_OP='INSERT' THEN NEW.created_at := clock_timestamp(); END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW.batch_id,NEW.participant_id,NEW.source,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.batch_id,OLD.participant_id,OLD.source,OLD.created_at) THEN
    RAISE EXCEPTION 'Candidate identity is immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER award_candidates_protect BEFORE INSERT OR UPDATE OR DELETE ON award_candidates
  FOR EACH ROW EXECUTE FUNCTION protect_award_candidate();

CREATE FUNCTION protect_award_instance_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN RAISE EXCEPTION 'Instance batch is immutable'; END IF;
  IF TG_OP='INSERT' AND NEW.batch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM award_batches b JOIN award_candidates c ON c.batch_id=b.id
    WHERE b.id=NEW.batch_id AND b.award_id=NEW.award_id AND b.status='draft'
      AND c.participant_id=NEW.participant_id AND c.status='included'
      AND c.reason=NEW.reason AND c.personal_address=NEW.personal_address) THEN
    RAISE EXCEPTION 'Offer must match an included draft candidate';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER award_instances_batch_protect BEFORE INSERT OR UPDATE ON award_instances
  FOR EACH ROW EXECUTE FUNCTION protect_award_instance_batch();
CREATE FUNCTION check_award_release_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.batch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM award_batches WHERE id=NEW.batch_id AND status='finalized') THEN
    RAISE EXCEPTION 'Batch offers cannot commit before finalization';
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER award_release_complete AFTER INSERT ON award_instances
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_award_release_complete();

CREATE FUNCTION record_award_batch_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO events(event_type,participant_id,payload,created_at)
      VALUES ('award.batch_created',NEW.created_by_participant_id,jsonb_build_object('batch_id',NEW.id,'award_id',NEW.award_id,'kind',NEW.kind),NEW.created_at);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO events(event_type,participant_id,payload,created_at)
      VALUES ('award.batch_finalized',NEW.finalized_by_participant_id,jsonb_build_object('batch_id',NEW.id,'award_id',NEW.award_id),NEW.finalized_at);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER award_batches_event AFTER INSERT OR UPDATE ON award_batches FOR EACH ROW EXECUTE FUNCTION record_award_batch_event();
