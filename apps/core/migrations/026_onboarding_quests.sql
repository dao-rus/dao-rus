-- Serialize the cutover with every existing writer, including the previous web image.
LOCK TABLE participants, participant_interests, profile_signals, darus_ledger, events IN ACCESS EXCLUSIVE MODE;

CREATE TABLE onboarding_quest_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('residence_first_filled', 'interest_first_added', 'need_first_created', 'have_first_created')),
  first_action_at timestamptz NOT NULL,
  origin text NOT NULL CHECK (origin IN ('historical', 'live')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (participant_id, source_type)
);
CREATE TRIGGER onboarding_completions_append_only BEFORE UPDATE OR DELETE ON onboarding_quest_completions
  FOR EACH ROW EXECUTE FUNCTION forbid_tokenization_record_change();

ALTER TABLE reward_rules DROP CONSTRAINT reward_rules_action_type_check;
ALTER TABLE reward_rules ADD CONSTRAINT reward_rules_action_type_check CHECK (action_type IN (
  'verification_created', 'residence_first_filled', 'interest_first_added', 'need_first_created', 'have_first_created', 'onboarding_promise_reconciled'));
INSERT INTO reward_rules(action_type, version, amount, active, changed_by) VALUES
  ('interest_first_added', 1, 0.1, true, 'system'),
  ('need_first_created', 1, 0.2, true, 'system'),
  ('have_first_created', 1, 0.2, true, 'system'),
  ('onboarding_promise_reconciled', 1, 0.1, true, 'system:c926a20');

ALTER TABLE darus_ledger DROP CONSTRAINT darus_ledger_source_type_check;
ALTER TABLE darus_ledger ADD CONSTRAINT darus_ledger_source_type_check CHECK (
  (source_type = 'verification_created' AND source_attestation_id IS NOT NULL AND source_subject_id IS NOT NULL AND participant_id <> source_subject_id)
  OR (source_type IN ('residence_first_filled', 'interest_first_added', 'need_first_created', 'have_first_created', 'onboarding_promise_reconciled')
    AND source_attestation_id IS NULL AND source_subject_id IS NULL));
CREATE UNIQUE INDEX darus_ledger_onboarding_once_idx ON darus_ledger(participant_id, source_type)
  WHERE source_type IN ('residence_first_filled', 'interest_first_added', 'need_first_created', 'have_first_created', 'onboarding_promise_reconciled');

-- BEGIN HISTORY QUERY (also used by the read-only reconciliation dry-run)
CREATE VIEW onboarding_first_action_history AS
WITH evidence AS (
  SELECT participant_id, 'residence_first_filled'::text AS source_type, created_at AS action_at, false AS confirmed
    FROM events WHERE event_type = 'participant.about_updated' AND payload->>'field' = 'residence'
  UNION ALL
  SELECT participant_id, 'interest_first_added', created_at, event_type = 'participant.interest_saved'
    FROM events WHERE event_type IN ('participant.interest_saved', 'participant.interest_removed')
  UNION ALL
  SELECT participant_id, (payload->>'kind') || '_first_created', created_at, true
    FROM events WHERE event_type = 'participant.signal_created' AND payload->>'kind' IN ('need', 'have')
  UNION ALL
  SELECT participant_id, 'residence_first_filled', created_at, true FROM darus_ledger WHERE source_type = 'residence_first_filled'
  UNION ALL
  SELECT participant_id, 'interest_first_added', created_at, true FROM participant_interests
  UNION ALL
  SELECT participant_id, kind || '_first_created', created_at, true FROM profile_signals WHERE kind IN ('need', 'have')
  UNION ALL
  -- Old residence events omit the value. Conservatively complete the quest, but
  -- never reconcile an unprovable historical fill using current updated_at.
  SELECT id, 'residence_first_filled', created_at, false FROM participants WHERE residence_name IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM events WHERE participant_id = participants.id AND event_type = 'participant.about_updated' AND payload->>'field' = 'residence')
    AND NOT EXISTS (SELECT 1 FROM darus_ledger WHERE participant_id = participants.id AND source_type = 'residence_first_filled')
)
SELECT participant_id, source_type, min(action_at) AS first_action_at,
       min(action_at) FILTER (WHERE confirmed) AS confirmed_action_at
  FROM evidence WHERE participant_id IS NOT NULL GROUP BY participant_id, source_type;
-- END HISTORY QUERY

INSERT INTO onboarding_quest_completions(participant_id, source_type, first_action_at, origin)
SELECT participant_id, source_type, first_action_at, 'historical' FROM onboarding_first_action_history;

CREATE TABLE onboarding_reconciliation_runs (
  id text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  CHECK (window_end > window_start)
);
INSERT INTO onboarding_reconciliation_runs VALUES ('c926a20', '2026-10-02T10:42:19.468435061Z', clock_timestamp());
CREATE TRIGGER onboarding_reconciliation_append_only BEFORE UPDATE OR DELETE ON onboarding_reconciliation_runs
  FOR EACH ROW EXECUTE FUNCTION forbid_tokenization_record_change();

-- One promise per participant, not one reward per historical quest. A residence
-- reward already received in this window satisfies the original 0.1 promise.
WITH candidates AS (
  SELECT DISTINCT history.participant_id
    FROM onboarding_first_action_history history CROSS JOIN onboarding_reconciliation_runs run
   WHERE run.id = 'c926a20' AND history.first_action_at >= run.window_start
     AND history.first_action_at < run.window_end AND history.confirmed_action_at IS NOT NULL
     AND history.confirmed_action_at < run.window_end
     AND NOT EXISTS (SELECT 1 FROM darus_ledger ledger WHERE ledger.participant_id = history.participant_id
       AND ledger.source_type = 'residence_first_filled' AND ledger.created_at >= run.window_start AND ledger.created_at < run.window_end)
), rewarded AS (
  INSERT INTO darus_ledger(participant_id, amount, reward_rule_id, reward_rule_version, source_type)
  SELECT candidates.participant_id, rule.amount, rule.id, rule.version, 'onboarding_promise_reconciled'
    FROM candidates CROSS JOIN reward_rules rule WHERE rule.action_type = 'onboarding_promise_reconciled' AND rule.version = 1
  ON CONFLICT DO NOTHING RETURNING id, participant_id, amount
)
INSERT INTO events(event_type, participant_id, payload)
SELECT 'onboarding.promise_reconciled', participant_id, jsonb_build_object('release', 'c926a20', 'ledger_id', rewarded.id, 'amount', amount,
  'window_start', run.window_start, 'window_end', run.window_end)
  FROM rewarded CROSS JOIN onboarding_reconciliation_runs run WHERE run.id = 'c926a20';

CREATE FUNCTION complete_onboarding_first_action() RETURNS trigger AS $$
DECLARE
  actor uuid;
  source text;
  completion uuid;
  reward uuid;
  reward_amount numeric;
BEGIN
  IF TG_TABLE_NAME = 'participants' THEN
    IF NEW.residence_name IS NULL OR OLD.residence_name IS NOT NULL THEN RETURN NEW; END IF;
    actor := NEW.id; source := 'residence_first_filled';
  ELSIF TG_TABLE_NAME = 'participant_interests' THEN
    actor := NEW.participant_id; source := 'interest_first_added';
  ELSE
    IF NEW.kind NOT IN ('need', 'have') THEN RETURN NEW; END IF;
    actor := NEW.participant_id; source := NEW.kind || '_first_created';
  END IF;
  INSERT INTO onboarding_quest_completions(participant_id, source_type, first_action_at, origin)
    VALUES (actor, source, clock_timestamp(), 'live') ON CONFLICT DO NOTHING RETURNING id INTO completion;
  IF completion IS NULL THEN RETURN NEW; END IF;
  INSERT INTO darus_ledger(participant_id, amount, reward_rule_id, reward_rule_version, source_type)
    SELECT actor, rule.amount, rule.id, rule.version, source FROM (
      SELECT * FROM reward_rules WHERE action_type = source AND effective_from <= clock_timestamp()
        AND (effective_to IS NULL OR effective_to > clock_timestamp())
      ORDER BY version DESC LIMIT 1
    ) rule WHERE rule.active
    ON CONFLICT DO NOTHING RETURNING id, amount INTO reward, reward_amount;
  INSERT INTO events(event_type, participant_id, payload) VALUES ('onboarding.quest_completed', actor,
    jsonb_build_object('completion_id', completion, 'source_type', source, 'ledger_id', reward,
      'amount', reward_amount, 'transaction_id', txid_current()::text));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER onboarding_residence AFTER UPDATE OF residence_name ON participants
  FOR EACH ROW EXECUTE FUNCTION complete_onboarding_first_action();
CREATE TRIGGER onboarding_interest AFTER INSERT ON participant_interests
  FOR EACH ROW EXECUTE FUNCTION complete_onboarding_first_action();
CREATE TRIGGER onboarding_signal AFTER INSERT ON profile_signals
  FOR EACH ROW EXECUTE FUNCTION complete_onboarding_first_action();
