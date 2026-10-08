-- Guardian writes each voluntary departure from the forum into the departures channel once.
-- A row means "claimed"; message_id is filled once Telegram accepted the message.
CREATE TABLE departure_log_posts (
  event_id bigint PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  message_id bigint,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

-- Everything that left before this release is already in the channel (entered by hand).
INSERT INTO departure_log_posts(event_id) SELECT id FROM events WHERE event_type IN ('forum.left', 'forum.removed');
