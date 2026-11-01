-- Moderation decisions are recorded separately from raw reactions.
-- No automatic Telegram restrictions are enabled by this migration.
CREATE TABLE telegram_hub_moderation_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hub_id text NOT NULL REFERENCES telegram_hubs(id) ON DELETE RESTRICT,
  target_user_id text NOT NULL CHECK (target_user_id ~ '^[1-9][0-9]{0,15}$'),
  kind text NOT NULL CHECK (kind IN ('warning','mute','vote_opened','excluded','appeal','reversal')),
  independent_dislikes integer NOT NULL DEFAULT 0 CHECK (independent_dislikes >= 0),
  episode_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (hub_id,target_user_id,kind,episode_key)
);
CREATE INDEX telegram_hub_moderation_recent_idx
 ON telegram_hub_moderation_events(hub_id,target_user_id,kind,created_at DESC);
CREATE TABLE telegram_hub_moderation_config (
  hub_id text PRIMARY KEY REFERENCES telegram_hubs(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  actor_attribution_verified boolean NOT NULL DEFAULT false,
  telegram_restriction_verified boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR (actor_attribution_verified AND telegram_restriction_verified))
);
