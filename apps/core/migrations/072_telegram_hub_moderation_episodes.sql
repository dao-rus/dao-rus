-- An episode starts with the first threshold crossing and can yield at most
-- one warning and one mute. Telegram API effects must be reconciled separately.
CREATE TABLE telegram_hub_moderation_episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id text NOT NULL REFERENCES telegram_hubs(id) ON DELETE RESTRICT,
  target_user_id text NOT NULL CHECK (target_user_id ~ '^[1-9][0-9]{0,15}$'),
  started_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  warning_recorded_at timestamptz,
  mute_recorded_at timestamptz,
  CHECK (closed_at IS NULL OR closed_at >= started_at)
);
CREATE UNIQUE INDEX telegram_hub_one_active_moderation_episode_idx
  ON telegram_hub_moderation_episodes(hub_id,target_user_id) WHERE closed_at IS NULL;

-- Persist intended effects for retry and audit. Workers must not mark a mute
-- applied until Telegram confirms the restriction.
CREATE TABLE telegram_hub_moderation_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  episode_id uuid NOT NULL REFERENCES telegram_hub_moderation_episodes(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('warning','mute')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','applied','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retry_at timestamptz,
  applied_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id,action)
);
CREATE INDEX telegram_hub_moderation_outbox_due_idx
  ON telegram_hub_moderation_outbox(retry_at,created_at) WHERE status='pending';
