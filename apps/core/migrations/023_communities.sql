CREATE TABLE community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE community_post_targets (
  post_id uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  community_type text NOT NULL CHECK (community_type IN ('residence', 'interest')),
  community_key text NOT NULL,
  PRIMARY KEY (post_id, community_type, community_key)
);

CREATE INDEX community_post_targets_lookup_idx
  ON community_post_targets (community_type, community_key, post_id);

ALTER TABLE reward_rules DROP CONSTRAINT reward_rules_action_type_check;
ALTER TABLE reward_rules ADD CONSTRAINT reward_rules_action_type_check
  CHECK (action_type IN ('verification_created', 'residence_first_filled'));

INSERT INTO reward_rules(action_type, version, amount, active, changed_by)
VALUES ('residence_first_filled', 1, 0.1, true, 'system');

ALTER TABLE darus_ledger DROP CONSTRAINT darus_ledger_source_type_check;
ALTER TABLE darus_ledger ALTER COLUMN source_attestation_id DROP NOT NULL;
ALTER TABLE darus_ledger ALTER COLUMN source_subject_id DROP NOT NULL;
ALTER TABLE darus_ledger ADD CONSTRAINT darus_ledger_source_type_check CHECK (
  (source_type = 'verification_created' AND source_attestation_id IS NOT NULL
    AND source_subject_id IS NOT NULL AND participant_id <> source_subject_id)
  OR (source_type = 'residence_first_filled' AND source_attestation_id IS NULL
    AND source_subject_id IS NULL)
);

CREATE UNIQUE INDEX darus_ledger_residence_once_idx
  ON darus_ledger(participant_id) WHERE source_type = 'residence_first_filled';

-- Existing filled profiles have already performed the rewarded action.
INSERT INTO darus_ledger(participant_id, amount, reward_rule_id, reward_rule_version, source_type)
SELECT participant.id, rule.amount, rule.id, rule.version, 'residence_first_filled'
  FROM participants participant
 CROSS JOIN reward_rules rule
 WHERE participant.residence_name IS NOT NULL
   AND rule.action_type = 'residence_first_filled' AND rule.version = 1;
