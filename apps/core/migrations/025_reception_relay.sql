-- Update IDs belong to the Reception bot and must not share the Dev bot ledger.
-- Telegram remains the message store; only routing and delivery metadata live here.
CREATE TABLE reception_relay_updates (
  update_id bigint PRIMARY KEY,
  direction text NOT NULL CHECK (direction IN ('private_to_forum', 'forum_to_private')),
  forum_chat_id bigint NOT NULL,
  private_chat_id bigint NOT NULL,
  private_message_id bigint,
  forum_message_id bigint,
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'unsupported')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'sent' OR (private_message_id IS NOT NULL AND forum_message_id IS NOT NULL))
);

CREATE UNIQUE INDEX reception_relay_forum_message_idx
  ON reception_relay_updates(forum_chat_id, forum_message_id)
  WHERE forum_message_id IS NOT NULL;
