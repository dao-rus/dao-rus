CREATE TABLE reward_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL CHECK (action_type = 'verification_created'),
  version integer NOT NULL CHECK (version > 0),
  amount numeric(20, 6) NOT NULL CHECK (amount > 0),
  active boolean NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  changed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_type, version),
  UNIQUE (id, version, amount),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

INSERT INTO reward_rules(action_type, version, amount, active, changed_by)
VALUES ('verification_created', 1, 0.1, true, 'system');

CREATE TABLE darus_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  amount numeric(20, 6) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'DARUS' CHECK (currency = 'DARUS'),
  reward_rule_id uuid NOT NULL,
  reward_rule_version integer NOT NULL CHECK (reward_rule_version > 0),
  source_type text NOT NULL CHECK (source_type = 'verification_created'),
  source_attestation_id uuid NOT NULL REFERENCES verification_attestations(id) ON DELETE RESTRICT,
  source_subject_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (participant_id <> source_subject_id),
  FOREIGN KEY (reward_rule_id, reward_rule_version, amount)
    REFERENCES reward_rules(id, version, amount) ON DELETE RESTRICT,
  UNIQUE (source_attestation_id)
);

CREATE UNIQUE INDEX darus_ledger_verification_pair_idx
  ON darus_ledger(participant_id, source_subject_id)
  WHERE source_type = 'verification_created';

CREATE INDEX darus_ledger_participant_history_idx
  ON darus_ledger(participant_id, created_at DESC, id DESC);

CREATE FUNCTION forbid_tokenization_record_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tokenization records are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER darus_ledger_no_update_or_delete
  BEFORE UPDATE OR DELETE ON darus_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_tokenization_record_change();

CREATE TRIGGER reward_rules_no_update_or_delete
  BEFORE UPDATE OR DELETE ON reward_rules
  FOR EACH ROW EXECUTE FUNCTION forbid_tokenization_record_change();
