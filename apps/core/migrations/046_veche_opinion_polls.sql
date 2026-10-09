-- Opinion polls extend proposals. Legacy proposals keep all nullable poll fields empty.
ALTER TABLE proposals
  ADD COLUMN poll_circle text CHECK (poll_circle IN ('dao','city')),
  ADD COLUMN poll_city text,
  ADD COLUMN poll_mode text CHECK (poll_mode IN ('secret','open')),
  ADD COLUMN poll_deadline timestamptz,
  ADD COLUMN poll_last_new_vote_at timestamptz,
  ADD COLUMN poll_closed_at timestamptz,
  ADD COLUMN poll_eligible_count integer,
  ADD COLUMN poll_quorum numeric CHECK (poll_quorum BETWEEN 0 AND 1),
  ADD COLUMN poll_announcement_claimed_at timestamptz,
  ADD COLUMN poll_announcement_message_id bigint,
  ADD CONSTRAINT proposals_poll_config CHECK (
    (poll_circle IS NULL AND poll_city IS NULL AND poll_mode IS NULL AND poll_deadline IS NULL)
    OR (poll_circle IS NOT NULL AND poll_mode IS NOT NULL
        AND ((poll_circle='dao' AND poll_city IS NULL) OR (poll_circle='city' AND poll_city IS NOT NULL AND btrim(poll_city)<>'')))
  );

CREATE TABLE veche_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  inactivity_days integer CHECK(inactivity_days BETWEEN 1 AND 36500),
  quorum_dao numeric NOT NULL DEFAULT 0 CHECK(quorum_dao BETWEEN 0 AND 1),
  quorum_city numeric NOT NULL DEFAULT 0 CHECK(quorum_city BETWEEN 0 AND 1)
);
INSERT INTO veche_settings(singleton) VALUES(true);

CREATE TABLE proposal_votes (
  proposal_id uuid NOT NULL REFERENCES proposals(id),
  participant_id uuid NOT NULL REFERENCES participants(id),
  choice text NOT NULL CHECK(choice IN ('yes','no','abstain')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(proposal_id,participant_id)
);
CREATE INDEX proposals_pending_polls ON proposals(poll_deadline) WHERE poll_circle IS NOT NULL AND poll_closed_at IS NULL;

CREATE FUNCTION veche_eligible(p participants, circle text, city text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
 SELECT p.membership_status='participant' AND btrim(COALESCE(p.residence_name,''))<>''
   AND (circle='dao' OR lower(btrim(p.residence_name))=city)
$$;

CREATE FUNCTION veche_poll_config_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE author participants;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF ROW(OLD.author_participant_id,OLD.title,OLD.body,OLD.poll_circle,OLD.poll_city,OLD.poll_mode,OLD.poll_deadline)
      IS DISTINCT FROM ROW(NEW.author_participant_id,NEW.title,NEW.body,NEW.poll_circle,NEW.poll_city,NEW.poll_mode,NEW.poll_deadline)
      AND (OLD.poll_circle IS NOT NULL OR NEW.poll_circle IS NOT NULL) THEN
     RAISE EXCEPTION 'Poll configuration is immutable';
   END IF;
   IF OLD.poll_closed_at IS NOT NULL AND ROW(OLD.poll_closed_at,OLD.poll_eligible_count,OLD.poll_quorum,OLD.poll_last_new_vote_at)
      IS DISTINCT FROM ROW(NEW.poll_closed_at,NEW.poll_eligible_count,NEW.poll_quorum,NEW.poll_last_new_vote_at) THEN
     RAISE EXCEPTION 'Closed poll is immutable';
   END IF;
 ELSIF NEW.poll_circle IS NOT NULL THEN
   SELECT * INTO author FROM participants WHERE id=NEW.author_participant_id FOR SHARE;
   IF NOT veche_eligible(author,'dao',NULL) THEN RAISE EXCEPTION 'Poll author is not eligible'; END IF;
   IF NEW.poll_circle='city' AND NEW.poll_city IS DISTINCT FROM lower(btrim(author.residence_name)) THEN
     RAISE EXCEPTION 'Poll city must be the author city';
   END IF;
   IF NEW.poll_deadline IS NOT NULL AND NEW.poll_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'Poll deadline must be in the future'; END IF;
   NEW.poll_last_new_vote_at:=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proposals_poll_config_guard BEFORE INSERT OR UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION veche_poll_config_guard();

-- Serializes closure against votes. Eligible population and quorum are frozen at closure.
CREATE FUNCTION veche_close_poll(poll_id uuid, closing_author uuid DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE p proposals; s veche_settings; eligible integer; due boolean;
BEGIN
 SELECT * INTO p FROM proposals WHERE id=poll_id FOR UPDATE;
 IF p.poll_circle IS NULL OR p.poll_closed_at IS NOT NULL THEN RETURN false; END IF;
 SELECT * INTO s FROM veche_settings WHERE singleton;
 due:=(p.poll_deadline IS NOT NULL AND p.poll_deadline<=clock_timestamp()) OR
      (p.poll_deadline IS NULL AND s.inactivity_days IS NOT NULL AND
       p.poll_last_new_vote_at + make_interval(days=>s.inactivity_days)<=clock_timestamp());
 IF NOT COALESCE(due,false) AND NOT (p.poll_deadline IS NULL AND COALESCE(closing_author=p.author_participant_id,false)) THEN RETURN false; END IF;
 SELECT count(*) INTO eligible FROM participants member WHERE veche_eligible(member,p.poll_circle,p.poll_city);
 UPDATE proposals SET poll_closed_at=clock_timestamp(),poll_eligible_count=eligible,
   poll_quorum=CASE p.poll_circle WHEN 'dao' THEN s.quorum_dao ELSE s.quorum_city END WHERE id=poll_id;
 RETURN true;
END $$;

CREATE FUNCTION veche_vote_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p proposals; member participants; inactivity integer;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Votes cannot be deleted'; END IF;
 IF TG_OP='UPDATE' AND ROW(OLD.proposal_id,OLD.participant_id,OLD.created_at) IS DISTINCT FROM ROW(NEW.proposal_id,NEW.participant_id,NEW.created_at) THEN
   RAISE EXCEPTION 'Vote identity is immutable';
 END IF;
 SELECT * INTO p FROM proposals WHERE id=NEW.proposal_id FOR UPDATE;
 SELECT inactivity_days INTO inactivity FROM veche_settings WHERE singleton;
 IF p.poll_circle IS NULL OR p.poll_closed_at IS NOT NULL OR p.poll_deadline<=clock_timestamp() OR
    (p.poll_deadline IS NULL AND inactivity IS NOT NULL AND p.poll_last_new_vote_at + make_interval(days=>inactivity)<=clock_timestamp()) THEN
   RAISE EXCEPTION 'Poll is not open';
 END IF;
 SELECT * INTO member FROM participants WHERE id=NEW.participant_id FOR SHARE;
 IF NOT veche_eligible(member,p.poll_circle,p.poll_city) THEN RAISE EXCEPTION 'Voter is not eligible'; END IF;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER proposal_votes_guard BEFORE INSERT OR UPDATE OR DELETE ON proposal_votes FOR EACH ROW EXECUTE FUNCTION veche_vote_guard();
CREATE FUNCTION veche_new_vote_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE proposals SET poll_last_new_vote_at=clock_timestamp() WHERE id=NEW.proposal_id;
 RETURN NEW;
END $$;
CREATE TRIGGER proposal_votes_activity AFTER INSERT ON proposal_votes FOR EACH ROW EXECUTE FUNCTION veche_new_vote_activity();
