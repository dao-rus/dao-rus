-- Empty marks share the poll lock with ballots and closure. Defaults keep the mechanism off.
ALTER TABLE veche_settings ADD COLUMN empty_fraction numeric CHECK(empty_fraction>0 AND empty_fraction<=1),
 ADD COLUMN empty_signal_count integer CHECK(empty_signal_count BETWEEN 1 AND 2147483647),
 ADD COLUMN empty_signal_days integer CHECK(empty_signal_days BETWEEN 1 AND 36500);
ALTER TABLE proposals ADD COLUMN poll_empty boolean NOT NULL DEFAULT false,
 ADD COLUMN poll_empty_fraction numeric CHECK(poll_empty_fraction>0 AND poll_empty_fraction<=1);
CREATE TABLE proposal_empty_marks (
 proposal_id uuid NOT NULL REFERENCES proposals(id), participant_id uuid NOT NULL REFERENCES participants(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(proposal_id,participant_id)
);
CREATE FUNCTION veche_empty_mark_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p proposals; member participants; s veche_settings; question uuid;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Empty mark identity is immutable'; END IF;
 question:=CASE WHEN TG_OP='DELETE' THEN OLD.proposal_id ELSE NEW.proposal_id END;
 SELECT * INTO p FROM proposals WHERE id=question FOR UPDATE;
 SELECT * INTO s FROM veche_settings WHERE singleton;
 IF p.poll_circle IS NULL OR p.poll_closed_at IS NOT NULL OR p.poll_call_state IN ('collecting','not_called')
    OR p.poll_deadline<=clock_timestamp() OR (p.poll_deadline IS NULL AND s.inactivity_days IS NOT NULL AND p.poll_last_new_vote_at+make_interval(days=>s.inactivity_days)<=clock_timestamp()) THEN
   RAISE EXCEPTION 'Poll is not open';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF s.empty_fraction IS NULL THEN RAISE EXCEPTION 'Empty marks are disabled'; END IF;
 IF NEW.participant_id=p.author_participant_id THEN RAISE EXCEPTION 'Author cannot mark own poll'; END IF;
 SELECT * INTO member FROM participants WHERE id=NEW.participant_id FOR SHARE;
 IF NOT COALESCE(veche_eligible(member,p.poll_circle,p.poll_city),false) THEN RAISE EXCEPTION 'Marker is not eligible'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proposal_empty_marks_guard BEFORE INSERT OR UPDATE OR DELETE ON proposal_empty_marks FOR EACH ROW EXECUTE FUNCTION veche_empty_mark_guard();
CREATE FUNCTION veche_empty_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fraction numeric; voters integer; marks integer;
BEGIN
 IF TG_OP='INSERT' THEN NEW.poll_empty:=false; NEW.poll_empty_fraction:=NULL; RETURN NEW; END IF;
 IF OLD.poll_closed_at IS NULL AND NEW.poll_closed_at IS NOT NULL THEN
   SELECT empty_fraction INTO fraction FROM veche_settings WHERE singleton;
   SELECT count(*) INTO voters FROM proposal_votes WHERE proposal_id=OLD.id;
   SELECT count(*) INTO marks FROM proposal_empty_marks WHERE proposal_id=OLD.id;
   NEW.poll_empty_fraction:=fraction;
   NEW.poll_empty:=fraction IS NOT NULL AND voters>0 AND marks>=ceil(voters*fraction);
 ELSIF ROW(OLD.poll_empty,OLD.poll_empty_fraction) IS DISTINCT FROM ROW(NEW.poll_empty,NEW.poll_empty_fraction) THEN
   RAISE EXCEPTION 'Empty result is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proposals_empty_result_guard BEFORE INSERT OR UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION veche_empty_result_guard();

-- Attention distributions remain independent; only public-good mint is suppressed.
CREATE OR REPLACE FUNCTION veche_settle(poll_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p proposals; f veche_finance; held darus_holds; r reward_rules; voter record; n bigint; units numeric; share numeric; remainder numeric; due timestamptz; active_dao integer;
BEGIN
 SELECT * INTO p FROM proposals WHERE id=poll_id FOR UPDATE;
 SELECT * INTO f FROM veche_finance WHERE proposal_id=poll_id;
 IF NOT FOUND OR (p.poll_call_state IS NOT NULL AND p.poll_call_state<>'called') THEN RETURN; END IF;
 due:=CASE WHEN p.poll_deadline IS NULL THEN COALESCE(p.poll_called_at,f.started_at)+make_interval(days=>f.attention_days) ELSE p.poll_closed_at END;
 IF p.poll_closed_at IS NULL AND (due IS NULL OR due>clock_timestamp()) THEN RETURN; END IF;
 -- Deterministic participant lock order covers both balances and the per-organizer cooldown.
 PERFORM 1 FROM participants WHERE id=p.author_participant_id OR id IN (SELECT participant_id FROM proposal_votes WHERE proposal_id=poll_id) ORDER BY id FOR UPDATE;
 IF f.hold_id IS NOT NULL AND due<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM veche_settlements WHERE proposal_id=poll_id AND kind='attention') THEN
  SELECT * INTO held FROM darus_holds WHERE id=f.hold_id FOR UPDATE;
  SELECT count(*) INTO n FROM proposal_votes WHERE proposal_id=poll_id AND (p.poll_deadline IS NOT NULL OR created_at<=due);
  IF n>0 THEN
   units:=held.amount*1000000; share:=floor(units/n); remainder:=units%n;
   FOR voter IN SELECT participant_id,row_number() OVER(ORDER BY created_at,participant_id) AS position FROM proposal_votes WHERE proposal_id=poll_id AND (p.poll_deadline IS NOT NULL OR created_at<=due) ORDER BY participant_id LOOP
    IF (share+CASE WHEN voter.position<=remainder THEN 1 ELSE 0 END)>0 THEN
     INSERT INTO darus_movements(participant_id,hold_id,kind,amount,source_type,source_id)
     VALUES(voter.participant_id,held.id,'distribution',(share+CASE WHEN voter.position<=remainder THEN 1 ELSE 0 END)::numeric/1000000,'veche_attention',poll_id);
    END IF;
   END LOOP;
  END IF;
  INSERT INTO veche_settlements VALUES(poll_id,'attention',clock_timestamp());
 END IF;
 IF p.poll_closed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM veche_settlements WHERE proposal_id=poll_id AND kind='rewards') THEN
  SELECT count(*) INTO n FROM proposal_votes WHERE proposal_id=poll_id;
  IF NOT p.poll_empty AND n>0 AND n>=ceil(p.poll_eligible_count*p.poll_quorum) THEN
   SELECT * INTO r FROM reward_rules WHERE id=f.participation_rule_id;
   IF r.active AND r.amount>0 THEN
    INSERT INTO darus_ledger(participant_id,amount,reward_rule_id,reward_rule_version,source_type,source_proposal_id)
    SELECT participant_id,r.amount,r.id,r.version,'veche_participation',poll_id FROM proposal_votes WHERE proposal_id=poll_id ORDER BY participant_id;
   END IF;
   SELECT count(*) INTO active_dao FROM participants WHERE membership_status='participant';
   SELECT * INTO r FROM reward_rules WHERE id=f.organizer_rule_id;
   IF r.active AND r.amount>0 AND f.organizer_fraction IS NOT NULL AND f.organizer_cooldown_days IS NOT NULL
    AND n>=ceil(active_dao*f.organizer_fraction)
    AND NOT EXISTS(SELECT 1 FROM darus_ledger WHERE participant_id=p.author_participant_id AND source_type='veche_organizer' AND created_at+make_interval(days=>f.organizer_cooldown_days)>clock_timestamp()) THEN
     INSERT INTO darus_ledger(participant_id,amount,reward_rule_id,reward_rule_version,source_type,source_proposal_id)
     VALUES(p.author_participant_id,r.amount,r.id,r.version,'veche_organizer',poll_id);
   END IF;
  END IF;
  INSERT INTO veche_settlements VALUES(poll_id,'rewards',clock_timestamp());
 END IF;
END $$;

-- Each action references a public empty question. No anonymous question is linked or grouped here.
CREATE TABLE veche_convocation_freezes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_proposal_id uuid NOT NULL REFERENCES proposals(id),
 decision_proposal_id uuid NOT NULL REFERENCES proposals(id), action text NOT NULL CHECK(action IN ('freeze','unfreeze')),
 expires_at timestamptz, actor_id uuid NOT NULL REFERENCES participants(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((action='freeze' AND expires_at IS NOT NULL) OR (action='unfreeze' AND expires_at IS NULL))
);
CREATE INDEX veche_freeze_source ON veche_convocation_freezes(source_proposal_id,created_at DESC);
CREATE FUNCTION veche_author_frozen(author uuid) RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT COALESCE((SELECT f.action='freeze' AND f.expires_at>clock_timestamp()
 FROM veche_convocation_freezes f JOIN proposals p ON p.id=f.source_proposal_id
 WHERE p.author_participant_id=author AND p.author_visibility='public' AND p.poll_empty
 ORDER BY f.created_at DESC,f.id DESC LIMIT 1),false)
$$;
CREATE FUNCTION veche_freeze_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source proposals; decision proposals; n integer; yes_votes integer; no_votes integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Convocation decisions are append-only'; END IF;
 SELECT * INTO source FROM proposals WHERE id=NEW.source_proposal_id;
 IF NOT FOUND OR source.author_visibility<>'public' OR NOT source.poll_empty OR source.poll_closed_at IS NULL THEN RAISE EXCEPTION 'Public empty question required'; END IF;
 -- The participant lock serializes manual sanctions with every call path.
 PERFORM 1 FROM participants WHERE id=source.author_participant_id FOR UPDATE;
 SELECT * INTO decision FROM proposals WHERE id=NEW.decision_proposal_id;
 IF NOT FOUND OR decision.author_visibility<>'public' OR decision.poll_circle IS DISTINCT FROM 'dao' OR decision.poll_mode IS DISTINCT FROM 'open' OR decision.poll_closed_at IS NULL OR decision.poll_empty THEN RAISE EXCEPTION 'Closed open DAO decision required'; END IF;
 SELECT count(*),count(*) FILTER(WHERE choice='yes'),count(*) FILTER(WHERE choice='no') INTO n,yes_votes,no_votes FROM proposal_votes WHERE proposal_id=decision.id;
 IF n=0 OR n<ceil(decision.poll_eligible_count*decision.poll_quorum) OR yes_votes<=no_votes THEN RAISE EXCEPTION 'Approved DAO decision required'; END IF;
 IF NEW.action='freeze' AND NEW.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Future freeze expiry required'; END IF;
 NEW.created_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER veche_freezes_guard BEFORE INSERT OR UPDATE OR DELETE ON veche_convocation_freezes FOR EACH ROW EXECUTE FUNCTION veche_freeze_guard();
CREATE TRIGGER veche_freezes_truncate_guard BEFORE TRUNCATE ON veche_convocation_freezes FOR EACH STATEMENT EXECUTE FUNCTION veche_freeze_guard();
CREATE FUNCTION veche_frozen_author_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.poll_circle IS NOT NULL AND (TG_OP='INSERT' OR (OLD.poll_call_state='collecting' AND NEW.poll_call_state='called')) THEN
   PERFORM 1 FROM participants WHERE id=NEW.author_participant_id FOR SHARE;
   IF veche_author_frozen(NEW.author_participant_id) THEN RAISE EXCEPTION 'Convocation right is frozen'; END IF;
 END IF;
 RETURN NEW;
END $$;
-- Alphabetically precedes signature/financial capture triggers and cannot be skipped by an adapter.
CREATE TRIGGER proposals_aaa_frozen_author_guard BEFORE INSERT OR UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION veche_frozen_author_guard();
