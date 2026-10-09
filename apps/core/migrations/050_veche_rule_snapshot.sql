ALTER TABLE veche_settings
 ADD COLUMN signature_minimum_dao integer NOT NULL DEFAULT 5 CHECK(signature_minimum_dao>=1),
 ADD COLUMN signature_minimum_city integer NOT NULL DEFAULT 5 CHECK(signature_minimum_city>=1);
ALTER TABLE proposals ADD COLUMN poll_rule_snapshot jsonb;
-- Current settings are migration metadata, not a claim to reconstruct old creation settings.
-- Preserve the already committed threshold/deadline; the Charter forbids rewriting active procedures.
UPDATE proposals p SET poll_rule_snapshot=jsonb_build_object(
 'fraction',CASE p.poll_circle WHEN 'dao' THEN s.signature_fraction_dao ELSE s.signature_fraction_city END,
 'minimum',CASE p.poll_circle WHEN 'dao' THEN s.signature_minimum_dao ELSE s.signature_minimum_city END,
 'required',p.poll_signatures_required,'population',p.poll_signature_population,
 'days',s.signature_days,'deadline',p.poll_signature_deadline,'circle',p.poll_circle,'origin','migration')
 FROM veche_settings s WHERE s.singleton AND p.poll_call_state IS NOT NULL;
CREATE OR REPLACE FUNCTION veche_signature_create_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s veche_settings; fraction numeric; population integer;
BEGIN
 IF NEW.poll_call_state IS NULL THEN RETURN NEW; END IF;
 IF NEW.poll_call_state<>'collecting' OR NEW.poll_circle IS NULL THEN RAISE EXCEPTION 'Signature call must start collecting'; END IF;
 SELECT * INTO s FROM veche_settings WHERE singleton FOR SHARE;
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
 NEW.poll_signatures_required:=greatest(CASE NEW.poll_circle WHEN 'dao' THEN s.signature_minimum_dao ELSE s.signature_minimum_city END,ceil(population*fraction)::integer);
 NEW.poll_signature_population:=population;
 NEW.poll_called_at:=NULL; NEW.poll_signature_failed_at:=NULL; NEW.poll_signature_count_at_call:=NULL;
 NEW.poll_signature_deadline:=clock_timestamp()+make_interval(days=>s.signature_days);
 NEW.poll_rule_snapshot:=jsonb_build_object('fraction',fraction,'minimum',CASE NEW.poll_circle WHEN 'dao' THEN s.signature_minimum_dao ELSE s.signature_minimum_city END,'required',NEW.poll_signatures_required,'population',population,'days',s.signature_days,'deadline',NEW.poll_signature_deadline,'circle',NEW.poll_circle,'origin','creation');
 RETURN NEW;
END $$;
CREATE FUNCTION veche_rule_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.poll_rule_snapshot IS DISTINCT FROM NEW.poll_rule_snapshot THEN RAISE EXCEPTION 'Veche rule snapshot is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proposals_rule_snapshot_guard BEFORE UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION veche_rule_snapshot_guard();
