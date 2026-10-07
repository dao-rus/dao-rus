-- Guardian routes between Core and the Telegram forum: settings, record discussions,
-- newcomer announcements.

-- Small key/value store for Guardian switches, topic routes and the bot name.
-- An absent `feature.*` key means the feature is on.
CREATE TABLE guardian_settings (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]{0,80}$'),
  value text NOT NULL CHECK (char_length(value) <= 200),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only people who join after this moment are announced as newcomers; the row's
-- updated_at is that moment and the key is never written again.
INSERT INTO guardian_settings(key, value) VALUES ('newcomers.since', 'migration 038');

-- One forum message per record. message_id is NULL only while it is being published.
CREATE TABLE signal_discussions (
  signal_id uuid PRIMARY KEY REFERENCES profile_signals(id) ON DELETE CASCADE,
  topic_id bigint NOT NULL CHECK (topic_id > 0),
  message_id bigint CHECK (message_id > 0),
  withdrawn boolean NOT NULL DEFAULT false,
  opened_by uuid NOT NULL REFERENCES participants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE participants ADD COLUMN announce_in_forum boolean NOT NULL DEFAULT true;

CREATE TABLE newcomer_announcements (
  participant_id uuid PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  topic_id bigint NOT NULL CHECK (topic_id > 0),
  message_id bigint CHECK (message_id > 0),
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
