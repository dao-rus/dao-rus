-- Verified Telegram display snapshots; never a replacement for the Participant profile.
ALTER TABLE reception_applications
  ADD COLUMN telegram_name text CHECK (char_length(telegram_name) <= 256),
  ADD COLUMN telegram_username text CHECK (telegram_username ~ '^[A-Za-z0-9_]{1,32}$');

-- A committed attempted_at means an external side effect is possible, even without its response.
ALTER TABLE reception_application_deliveries
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN claim_token uuid,
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN attempted_at timestamptz,
  ADD COLUMN attempted_revision integer CHECK (attempted_revision > 0),
  ADD COLUMN attempted_text text CHECK (char_length(attempted_text) <= 4096),
  ADD COLUMN telegram_topic_id bigint CHECK (telegram_topic_id > 0);

CREATE UNIQUE INDEX reception_publication_message_idx
  ON reception_application_deliveries(telegram_chat_id, telegram_message_id)
  WHERE kind='publication' AND telegram_message_id IS NOT NULL;

CREATE INDEX reception_publication_claim_idx ON reception_application_deliveries(claimed_at)
  WHERE kind='publication' AND status='processing';
