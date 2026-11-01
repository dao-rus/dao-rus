-- Durable Telegram-derived communication contributions, one global directed pair.
-- No backfill: only newly observed transitions affect balances.
CREATE TABLE communication_reaction_balances (
  actor_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  subject_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  balance smallint NOT NULL DEFAULT 0 CHECK (balance BETWEEN -1 AND 1),
  last_telegram_update_id bigint NOT NULL DEFAULT -1 CHECK (last_telegram_update_id >= -1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_participant_id, subject_participant_id),
  CHECK (actor_participant_id <> subject_participant_id)
);
CREATE INDEX communication_reaction_balances_subject_idx
  ON communication_reaction_balances(subject_participant_id);

-- Preserve each bounded contribution transition so balance recomputation is
-- deterministic even when different message/hub webhooks commit out of order.
CREATE TABLE communication_reaction_events (
  telegram_update_id bigint PRIMARY KEY CHECK (telegram_update_id >= 0),
  hub_id text NOT NULL REFERENCES telegram_hubs(id) ON DELETE RESTRICT,
  message_id bigint NOT NULL,
  actor_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  subject_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  delta smallint NOT NULL CHECK (delta IN (-1, 1)),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_participant_id <> subject_participant_id)
);
CREATE INDEX communication_reaction_events_pair_order_idx
  ON communication_reaction_events(actor_participant_id, subject_participant_id, telegram_update_id);
