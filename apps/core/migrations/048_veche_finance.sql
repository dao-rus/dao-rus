-- Monetary paths reuse the append-only DARUS ledger and holds. Defaults cannot mint or debit.
ALTER TABLE veche_settings
 ADD COLUMN tariff_base_dao numeric(20,6) CHECK(tariff_base_dao>0),
 ADD COLUMN tariff_base_city numeric(20,6) CHECK(tariff_base_city>0),
 ADD COLUMN tariff_multiplier_dao numeric(20,6) CHECK(tariff_multiplier_dao>0),
 ADD COLUMN tariff_multiplier_city numeric(20,6) CHECK(tariff_multiplier_city>0),
 ADD COLUMN attention_days integer NOT NULL DEFAULT 7 CHECK(attention_days BETWEEN 1 AND 36500),
 ADD COLUMN organizer_fraction numeric CHECK(organizer_fraction>0 AND organizer_fraction<=1),
 ADD COLUMN organizer_cooldown_days integer CHECK(organizer_cooldown_days BETWEEN 1 AND 36500);
ALTER TABLE proposals ADD COLUMN poll_paid boolean NOT NULL DEFAULT false;
ALTER TABLE reward_rules DROP CONSTRAINT reward_rules_action_type_check;
ALTER TABLE reward_rules ADD CONSTRAINT reward_rules_action_type_check CHECK(action_type IN (
 'verification_created','residence_first_filled','interest_first_added','need_first_created','have_first_created','onboarding_promise_reconciled','veche_participation','veche_organizer'));
ALTER TABLE reward_rules DROP CONSTRAINT reward_rules_amount_check;
ALTER TABLE reward_rules ADD CONSTRAINT reward_rules_amount_check CHECK(amount>0 OR (amount=0 AND action_type IN ('veche_participation','veche_organizer') AND NOT active));
INSERT INTO reward_rules(action_type,version,amount,active,changed_by) VALUES
 ('veche_participation',1,0,false,'system'),('veche_organizer',1,0,false,'system');
ALTER TABLE darus_ledger ADD COLUMN source_proposal_id uuid REFERENCES proposals(id) ON DELETE RESTRICT;
ALTER TABLE darus_ledger DROP CONSTRAINT darus_ledger_source_type_check;
ALTER TABLE darus_ledger ADD CONSTRAINT darus_ledger_source_type_check CHECK(
 (source_type='verification_created' AND source_attestation_id IS NOT NULL AND source_subject_id IS NOT NULL AND participant_id<>source_subject_id AND source_proposal_id IS NULL)
 OR (source_type IN ('residence_first_filled','interest_first_added','need_first_created','have_first_created','onboarding_promise_reconciled') AND source_attestation_id IS NULL AND source_subject_id IS NULL AND source_proposal_id IS NULL)
 OR (source_type IN ('veche_participation','veche_organizer') AND source_proposal_id IS NOT NULL AND source_attestation_id IS NULL AND source_subject_id IS NULL));
CREATE UNIQUE INDEX darus_ledger_veche_once ON darus_ledger(source_proposal_id,source_type,participant_id) WHERE source_proposal_id IS NOT NULL;
CREATE OR REPLACE VIEW darus_book AS
 SELECT id,participant_id,amount,currency,source_type,COALESCE(source_attestation_id,source_subject_id,source_proposal_id) AS source_id,
 NULL::uuid AS hold_id,'mint'::text AS kind,created_at FROM darus_ledger
 UNION ALL SELECT id,participant_id,amount,'DARUS',source_type,source_id,hold_id,kind,created_at FROM darus_movements;
CREATE TABLE veche_finance (
 proposal_id uuid PRIMARY KEY REFERENCES proposals(id) ON DELETE RESTRICT,
 hold_id uuid UNIQUE REFERENCES darus_holds(id) ON DELETE RESTRICT,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 population integer NOT NULL,
 attention_days integer NOT NULL,
 participation_rule_id uuid NOT NULL REFERENCES reward_rules(id),
 organizer_rule_id uuid NOT NULL REFERENCES reward_rules(id),
 organizer_fraction numeric,
 organizer_cooldown_days integer
);
CREATE TABLE veche_settlements (
 proposal_id uuid NOT NULL REFERENCES proposals(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('attention','rewards')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(proposal_id,kind)
);
CREATE TRIGGER veche_finance_append_only BEFORE UPDATE OR DELETE ON veche_finance FOR EACH ROW EXECUTE FUNCTION forbid_tokenization_record_change();
CREATE TRIGGER veche_finance_no_truncate BEFORE TRUNCATE ON veche_finance EXECUTE FUNCTION forbid_tokenization_record_change();
CREATE TRIGGER veche_settlements_append_only BEFORE UPDATE OR DELETE ON veche_settlements FOR EACH ROW EXECUTE FUNCTION forbid_tokenization_record_change();
CREATE TRIGGER veche_settlements_no_truncate BEFORE TRUNCATE ON veche_settlements EXECUTE FUNCTION forbid_tokenization_record_change();
CREATE FUNCTION veche_paid_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.poll_paid IS DISTINCT FROM NEW.poll_paid THEN RAISE EXCEPTION 'Paid call is immutable'; END IF;
 IF NEW.poll_paid AND (NEW.poll_circle IS NULL OR NEW.poll_call_state IS NOT NULL) THEN RAISE EXCEPTION 'Paid call cannot collect signatures'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proposals_paid_guard BEFORE INSERT OR UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION veche_paid_guard();
CREATE FUNCTION veche_capture_finance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s veche_settings; population integer; base numeric; multiplier numeric; tariff numeric; held uuid; participation uuid; organizer uuid;
BEGIN
 IF NEW.poll_circle IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO s FROM veche_settings WHERE singleton FOR SHARE;
 SELECT count(*) INTO population FROM participants member WHERE veche_eligible(member,NEW.poll_circle,NEW.poll_city);
 IF NEW.poll_paid THEN
  base:=CASE NEW.poll_circle WHEN 'dao' THEN s.tariff_base_dao ELSE s.tariff_base_city END;
  multiplier:=CASE NEW.poll_circle WHEN 'dao' THEN s.tariff_multiplier_dao ELSE s.tariff_multiplier_city END;
  IF base IS NULL OR multiplier IS NULL THEN RAISE EXCEPTION 'Paid call is disabled'; END IF;
  tariff:=trunc(base*multiplier*population,6);
  IF tariff<=0 THEN RAISE EXCEPTION 'Invalid call tariff'; END IF;
  INSERT INTO darus_holds(participant_id,amount,source_type,source_id)
   VALUES(NEW.author_participant_id,tariff,'veche_tariff',NEW.id) RETURNING id INTO held;
 END IF;
 SELECT id INTO participation FROM reward_rules WHERE action_type='veche_participation' AND effective_from<=clock_timestamp() AND (effective_to IS NULL OR effective_to>clock_timestamp()) ORDER BY version DESC LIMIT 1;
 SELECT id INTO organizer FROM reward_rules WHERE action_type='veche_organizer' AND effective_from<=clock_timestamp() AND (effective_to IS NULL OR effective_to>clock_timestamp()) ORDER BY version DESC LIMIT 1;
 INSERT INTO veche_finance(proposal_id,hold_id,population,attention_days,participation_rule_id,organizer_rule_id,organizer_fraction,organizer_cooldown_days) VALUES(NEW.id,held,population,s.attention_days,participation,organizer,s.organizer_fraction,s.organizer_cooldown_days);
 RETURN NEW;
END $$;
CREATE TRIGGER proposals_capture_finance AFTER INSERT ON proposals FOR EACH ROW EXECUTE FUNCTION veche_capture_finance();
-- Existing service polls retain disabled economics: migration never assigns funds or rewards retroactively.
CREATE FUNCTION veche_settle(poll_id uuid) RETURNS void LANGUAGE plpgsql AS $$
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
  IF n>0 AND n>=ceil(p.poll_eligible_count*p.poll_quorum) THEN
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
CREATE FUNCTION veche_settle_closed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.poll_closed_at IS NULL AND NEW.poll_closed_at IS NOT NULL THEN PERFORM veche_settle(NEW.id); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proposals_settle_closed AFTER UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION veche_settle_closed();
CREATE FUNCTION veche_tariff_release_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE held darus_holds;
BEGIN
 SELECT * INTO held FROM darus_holds WHERE id=NEW.hold_id;
 IF held.source_type='veche_tariff' AND NEW.kind<>'hold' AND
  (NEW.kind<>'distribution' OR NEW.source_type<>'veche_attention' OR NEW.source_id<>held.source_id) THEN
  RAISE EXCEPTION 'Veche tariff is non-refundable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER darus_movements_veche_guard BEFORE INSERT ON darus_movements FOR EACH ROW EXECUTE FUNCTION veche_tariff_release_guard();
