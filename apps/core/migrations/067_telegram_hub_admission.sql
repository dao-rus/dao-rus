CREATE TABLE telegram_hubs (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  chat_id bigint NOT NULL UNIQUE,
  title text NOT NULL,
  code_version text NOT NULL,
  response_timeout interval NOT NULL DEFAULT interval '24 hours'
    CHECK (response_timeout > interval '0' AND response_timeout <= interval '30 days'),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE telegram_hub_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id text NOT NULL REFERENCES telegram_hubs(id) ON DELETE RESTRICT,
  telegram_user_id text NOT NULL CHECK (telegram_user_id ~ '^[1-9][0-9]{0,15}$'),
  telegram_update_id bigint NOT NULL UNIQUE,
  request_date timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending', 'accepted', 'refused', 'expired', 'approved', 'approval_pending', 'declined')),
  participant_id uuid REFERENCES participants(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  decided_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retry_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 100),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status IN ('accepted','approved','approval_pending') AND accepted_at IS NOT NULL)
      OR (status NOT IN ('accepted','approved','approval_pending')))
);

CREATE UNIQUE INDEX telegram_hub_one_pending_request_idx
  ON telegram_hub_join_requests(hub_id, telegram_user_id) WHERE status = 'pending';
CREATE INDEX telegram_hub_requests_expiry_idx
  ON telegram_hub_join_requests(expires_at) WHERE status IN ('pending','approval_pending');

CREATE TABLE telegram_hub_memberships (
  hub_id text NOT NULL REFERENCES telegram_hubs(id) ON DELETE RESTRICT,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  telegram_user_id text NOT NULL CHECK (telegram_user_id ~ '^[1-9][0-9]{0,15}$'),
  accepted_at timestamptz NOT NULL,
  code_version text NOT NULL,
  join_request_id uuid NOT NULL UNIQUE REFERENCES telegram_hub_join_requests(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, participant_id),
  UNIQUE (hub_id, telegram_user_id)
);

CREATE INDEX telegram_hub_memberships_participant_idx ON telegram_hub_memberships(participant_id);
