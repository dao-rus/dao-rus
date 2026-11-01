-- Durable Telegram-derived communication contributions, one global directed pair.
-- No backfill: only newly observed transitions affect balances.
CREATE TABLE communication_reaction_balances (
  actor_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  subject_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  balance smallint NOT NULL DEFAULT 0 CHECK (balance BETWEEN -1 AND 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_participant_id, subject_participant_id),
  CHECK (actor_participant_id <> subject_participant_id)
);
CREATE INDEX communication_reaction_balances_subject_idx
  ON communication_reaction_balances(subject_participant_id);
