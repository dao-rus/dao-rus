-- One-time messages of the reception bot (e.g. the welcome after joining the forum),
-- keyed by Telegram user: the person may not have a Core participant yet.
CREATE TABLE reception_messages (
  telegram_user_id bigint NOT NULL CHECK (telegram_user_id > 0),
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{0,40}$'),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_user_id, kind)
);
