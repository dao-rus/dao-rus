-- A vote snapshots its electorate at opening. No votes or bans are triggered by this migration.
CREATE TABLE telegram_hub_exclusion_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id text NOT NULL REFERENCES telegram_hubs(id) ON DELETE RESTRICT,
  target_user_id text NOT NULL CHECK (target_user_id ~ '^[1-9][0-9]{0,15}$'),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closes_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','passed','rejected','cancelled')),
  eligible_count integer NOT NULL CHECK (eligible_count > 0),
  required_yes integer GENERATED ALWAYS AS (eligible_count / 2 + 1) STORED,
  closed_at timestamptz,
  CHECK (closes_at > opened_at),
  CHECK ((status = 'open' AND closed_at IS NULL) OR (status <> 'open' AND closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX telegram_hub_one_open_exclusion_vote_idx
  ON telegram_hub_exclusion_votes(hub_id,target_user_id) WHERE status = 'open';
CREATE INDEX telegram_hub_exclusion_votes_due_idx
  ON telegram_hub_exclusion_votes(closes_at) WHERE status = 'open';

CREATE TABLE telegram_hub_exclusion_electorate (
  vote_id uuid NOT NULL REFERENCES telegram_hub_exclusion_votes(id) ON DELETE CASCADE,
  telegram_user_id text NOT NULL CHECK (telegram_user_id ~ '^[1-9][0-9]{0,15}$'),
  choice boolean,
  voted_at timestamptz,
  PRIMARY KEY (vote_id,telegram_user_id),
  CHECK ((choice IS NULL AND voted_at IS NULL) OR (choice IS NOT NULL AND voted_at IS NOT NULL))
);
CREATE INDEX telegram_hub_exclusion_ballots_yes_idx
  ON telegram_hub_exclusion_electorate(vote_id) WHERE choice = true;
