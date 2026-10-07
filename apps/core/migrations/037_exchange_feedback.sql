-- Exchange feedback: view counter, personal hides, and the first need/have reward
-- moved from declaration to the first response of another participant.

-- A plain counter: who looked at what is deliberately not recorded.
CREATE TABLE signal_view_counts (
  signal_id uuid PRIMARY KEY REFERENCES profile_signals(id) ON DELETE CASCADE,
  views bigint NOT NULL DEFAULT 0 CHECK (views >= 0)
);

-- "Hide for me": affects only the hiding participant's own listings.
CREATE TABLE signal_hides (
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  signal_id uuid NOT NULL REFERENCES profile_signals(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_id, signal_id)
);

-- Residence and interest quests keep completing on the action itself.
-- Creating a need/have record no longer completes anything.
CREATE OR REPLACE FUNCTION complete_onboarding_first_action() RETURNS trigger AS $$
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
    -- A like or a Relay response from another participant to a need/have record.
    -- Both tables already forbid acting on one's own record.
    SELECT s.participant_id, s.kind || '_first_created' INTO actor, source
      FROM profile_signals s WHERE s.id = NEW.signal_id AND s.kind IN ('need', 'have');
    IF NOT FOUND THEN RETURN NEW; END IF;
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

DROP TRIGGER onboarding_signal ON profile_signals;
CREATE TRIGGER onboarding_signal_reaction AFTER INSERT ON signal_reactions
  FOR EACH ROW EXECUTE FUNCTION complete_onboarding_first_action();
CREATE TRIGGER onboarding_signal_response AFTER INSERT ON relay_encounters
  FOR EACH ROW EXECUTE FUNCTION complete_onboarding_first_action();
