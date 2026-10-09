ALTER TABLE veche_settings
 ADD COLUMN signature_fraction_dao numeric CHECK(signature_fraction_dao>0 AND signature_fraction_dao<=1),
 ADD COLUMN signature_fraction_city numeric CHECK(signature_fraction_city>0 AND signature_fraction_city<=1),
 ADD COLUMN signature_days integer NOT NULL DEFAULT 14 CHECK(signature_days BETWEEN 1 AND 36500),
 ADD COLUMN signature_cooldown_days integer CHECK(signature_cooldown_days BETWEEN 0 AND 36500);
ALTER TABLE proposals
 ADD COLUMN poll_call_state text CHECK(poll_call_state IN ('collecting','called','not_called')),
 ADD COLUMN poll_signature_deadline timestamptz,
 ADD COLUMN poll_signatures_required integer CHECK(poll_signatures_required>0),
 ADD COLUMN poll_signature_population integer,
 ADD COLUMN poll_called_at timestamptz,
 ADD COLUMN poll_signature_count_at_call integer,
 ADD COLUMN poll_signature_failed_at timestamptz,
 ADD COLUMN poll_collection_announcement_claimed_at timestamptz,
 ADD COLUMN poll_collection_announcement_message_id bigint;
CREATE TABLE proposal_signatures (
 proposal_id uuid NOT NULL REFERENCES proposals(id),
 participant_id uuid NOT NULL REFERENCES participants(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(proposal_id,participant_id)
);
CREATE INDEX proposals_collecting_signatures ON proposals(poll_signature_deadline) WHERE poll_call_state='collecting';

CREATE FUNCTION veche_signature_count(p proposals) RETURNS integer LANGUAGE sql STABLE AS $$
 SELECT count(*)::integer FROM proposal_signatures signature JOIN participants member ON member.id=signature.participant_id
 WHERE signature.proposal_id=p.id AND signature.participant_id<>p.author_participant_id
 AND veche_eligible(member,p.poll_circle,p.poll_city)
$$;
CREATE FUNCTION veche_refresh_call(poll_id uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE p proposals;
BEGIN
 SELECT * INTO p FROM proposals WHERE id=poll_id FOR UPDATE;
 IF p.poll_call_state IS DISTINCT FROM 'collecting' THEN RETURN p.poll_call_state; END IF;
 IF LEAST(p.poll_signature_deadline,COALESCE(p.poll_deadline,p.poll_signature_deadline))<=clock_timestamp() THEN
   UPDATE proposals SET poll_call_state='not_called',poll_signature_failed_at=LEAST(p.poll_signature_deadline,COALESCE(p.poll_deadline,p.poll_signature_deadline)) WHERE id=poll_id;
   RETURN 'not_called';
 END IF;
 IF veche_signature_count(p)>=p.poll_signatures_required THEN
   UPDATE proposals SET poll_call_state='called',poll_called_at=clock_timestamp(),poll_signature_count_at_call=veche_signature_count(p),poll_last_new_vote_at=clock_timestamp() WHERE id=poll_id;
   RETURN 'called';
 END IF;
 RETURN 'collecting';
END $$;

CREATE FUNCTION veche_signature_create_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s veche_settings; fraction numeric; population integer;
BEGIN
 IF NEW.poll_call_state IS NULL THEN RETURN NEW; END IF;
 IF NEW.poll_call_state<>'collecting' OR NEW.poll_circle IS NULL THEN RAISE EXCEPTION 'Signature call must start collecting'; END IF;
 SELECT * INTO s FROM veche_settings WHERE singleton;
 fraction:=CASE NEW.poll_circle WHEN 'dao' THEN s.signature_fraction_dao ELSE s.signature_fraction_city END;
 IF fraction IS NULL OR s.signature_cooldown_days IS NULL THEN RAISE EXCEPTION 'Signature settings are not configured'; END IF;
 -- One author's same circle shares a lock, including simultaneous resubmission.
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.author_participant_id::text||NEW.poll_circle||COALESCE(NEW.poll_city,''),0));
 UPDATE proposals SET poll_call_state='not_called',poll_signature_failed_at=LEAST(poll_signature_deadline,COALESCE(poll_deadline,poll_signature_deadline))
 WHERE author_participant_id=NEW.author_participant_id AND poll_circle=NEW.poll_circle AND poll_city IS NOT DISTINCT FROM NEW.poll_city
 AND poll_call_state='collecting' AND LEAST(poll_signature_deadline,COALESCE(poll_deadline,poll_signature_deadline))<=clock_timestamp();
 IF EXISTS(SELECT 1 FROM proposals WHERE author_participant_id=NEW.author_participant_id AND poll_circle=NEW.poll_circle
   AND poll_city IS NOT DISTINCT FROM NEW.poll_city AND poll_call_state='not_called'
   AND poll_signature_failed_at+make_interval(days=>s.signature_cooldown_days)>clock_timestamp()) THEN
   RAISE EXCEPTION 'Signature call cooldown has not ended';
 END IF;
 SELECT count(*) INTO population FROM participants member WHERE veche_eligible(member,NEW.poll_circle,NEW.poll_city);
 NEW.poll_signatures_required:=greatest(1,ceil(population*fraction)::integer);
 NEW.poll_signature_population:=population;
 NEW.poll_called_at:=NULL; NEW.poll_signature_failed_at:=NULL; NEW.poll_signature_count_at_call:=NULL;
 NEW.poll_signature_deadline:=clock_timestamp()+make_interval(days=>s.signature_days);
 RETURN NEW;
END $$;
CREATE TRIGGER proposals_signature_create_guard BEFORE INSERT ON proposals FOR EACH ROW EXECUTE FUNCTION veche_signature_create_guard();

CREATE FUNCTION veche_signature_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(OLD.poll_signature_deadline,OLD.poll_signatures_required,OLD.poll_signature_population)
 IS DISTINCT FROM ROW(NEW.poll_signature_deadline,NEW.poll_signatures_required,NEW.poll_signature_population) THEN
   RAISE EXCEPTION 'Signature configuration is immutable';
 END IF;
 IF OLD.poll_call_state IS DISTINCT FROM NEW.poll_call_state THEN
   IF OLD.poll_call_state IS DISTINCT FROM 'collecting' OR (NEW.poll_call_state IS NULL OR NEW.poll_call_state NOT IN ('called','not_called')) THEN RAISE EXCEPTION 'Signature call state is immutable'; END IF;
   IF NEW.poll_call_state='called' AND (veche_signature_count(OLD)<OLD.poll_signatures_required OR
     LEAST(OLD.poll_signature_deadline,COALESCE(OLD.poll_deadline,OLD.poll_signature_deadline))<=clock_timestamp()) THEN RAISE EXCEPTION 'Signature threshold is not reached'; END IF;
   IF NEW.poll_call_state='not_called' AND LEAST(OLD.poll_signature_deadline,COALESCE(OLD.poll_deadline,OLD.poll_signature_deadline))>clock_timestamp() THEN RAISE EXCEPTION 'Signature collection has not expired'; END IF;
 END IF;
 IF OLD.poll_call_state IN ('called','not_called') AND ROW(OLD.poll_called_at,OLD.poll_signature_count_at_call,OLD.poll_signature_failed_at) IS DISTINCT FROM ROW(NEW.poll_called_at,NEW.poll_signature_count_at_call,NEW.poll_signature_failed_at) THEN RAISE EXCEPTION 'Signature call outcome is immutable'; END IF;
 IF NEW.poll_call_state IS NOT NULL AND NEW.poll_call_state<>'called' AND NEW.poll_closed_at IS NOT NULL THEN RAISE EXCEPTION 'Uncalled poll cannot be closed as a vote'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proposals_signature_state_guard BEFORE UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION veche_signature_state_guard();

CREATE FUNCTION veche_signature_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p proposals; member participants; poll_id uuid;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Signatures cannot be edited'; END IF;
 poll_id:=CASE WHEN TG_OP='DELETE' THEN OLD.proposal_id ELSE NEW.proposal_id END;
 SELECT * INTO p FROM proposals WHERE id=poll_id FOR UPDATE;
 IF p.poll_call_state IS DISTINCT FROM 'collecting' OR LEAST(p.poll_signature_deadline,COALESCE(p.poll_deadline,p.poll_signature_deadline))<=clock_timestamp() THEN RAISE EXCEPTION 'Signature collection is not open'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 SELECT * INTO member FROM participants WHERE id=NEW.participant_id FOR SHARE;
 IF NOT veche_eligible(member,p.poll_circle,p.poll_city) THEN RAISE EXCEPTION 'Signer is not eligible'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proposal_signatures_guard BEFORE INSERT OR UPDATE OR DELETE ON proposal_signatures FOR EACH ROW EXECUTE FUNCTION veche_signature_guard();
CREATE FUNCTION veche_signature_added() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM veche_refresh_call(NEW.proposal_id);
 RETURN NEW;
END $$;
CREATE TRIGGER proposal_signatures_added AFTER INSERT ON proposal_signatures FOR EACH ROW EXECUTE FUNCTION veche_signature_added();
CREATE FUNCTION veche_called_vote_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
 SELECT poll_call_state INTO state FROM proposals WHERE id=NEW.proposal_id FOR UPDATE;
 IF state IS NOT NULL AND state<>'called' THEN RAISE EXCEPTION 'Poll has not been called'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proposal_votes_call_guard BEFORE INSERT OR UPDATE ON proposal_votes FOR EACH ROW EXECUTE FUNCTION veche_called_vote_guard();
