-- Per-message Telegram reactions are stored as state, not as cumulative events.
-- Enforcement is intentionally disabled until Telegram actor attribution is verified.
CREATE TABLE telegram_hub_reactions (
  hub_id text NOT NULL REFERENCES telegram_hubs(id) ON DELETE RESTRICT,
  message_id bigint NOT NULL,
  message_author_id text NOT NULL CHECK (message_author_id ~ '^[1-9][0-9]{0,15}$'),
  reactor_id text NOT NULL CHECK (reactor_id ~ '^[1-9][0-9]{0,15}$'),
  reaction text NOT NULL CHECK (reaction IN ('👍', '👎')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, message_id, reactor_id)
);
CREATE INDEX telegram_hub_reactions_target_idx
  ON telegram_hub_reactions(hub_id, message_author_id, reaction, updated_at);
CREATE TABLE telegram_hub_message_authors (
  hub_id text NOT NULL REFERENCES telegram_hubs(id) ON DELETE RESTRICT,
  message_id bigint NOT NULL,
  telegram_user_id text NOT NULL CHECK (telegram_user_id ~ '^[1-9][0-9]{0,15}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hub_id, message_id)
);
