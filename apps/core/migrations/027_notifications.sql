CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id),
  notification_type text NOT NULL CHECK (length(btrim(notification_type)) > 0),
  text text NOT NULL CHECK (length(btrim(text)) > 0),
  action_url text,
  source_type text NOT NULL CHECK (source_type IN ('system', 'admin')),
  created_by_participant_id uuid REFERENCES participants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CHECK (source_type <> 'admin' OR created_by_participant_id IS NOT NULL)
);

CREATE INDEX notifications_participant_created_idx
  ON notifications(participant_id, created_at DESC, id DESC);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel = 'telegram'),
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'blocked', 'failed', 'unknown')),
  attempted_at timestamptz,
  external_message_id text,
  error_code text,
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, channel)
);
