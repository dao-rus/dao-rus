CREATE TABLE reception_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id text NOT NULL UNIQUE
    CHECK (telegram_user_id ~ '^[1-9][0-9]{0,15}$'
      AND telegram_user_id::numeric <= 9007199254740991),
  participant_id uuid REFERENCES participants(id) ON DELETE SET NULL,
  city text NOT NULL CHECK (char_length(btrim(city)) BETWEEN 1 AND 200),
  occupation text NOT NULL CHECK (char_length(btrim(occupation)) BETWEEN 1 AND 1000),
  age smallint CHECK (age BETWEEN 1 AND 120),
  publish_age boolean NOT NULL DEFAULT false CHECK (NOT publish_age OR age IS NOT NULL),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'deferred', 'closed')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  write_window_started_at timestamptz NOT NULL DEFAULT now(),
  write_window_count integer NOT NULL DEFAULT 1 CHECK (write_window_count BETWEEN 1 AND 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Separate from ordinary relay traffic. No sender consumes these rows in stage 1.
-- The invitation row is created only by a future authorized Guardian action.
CREATE TABLE reception_application_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES reception_applications(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('publication', 'invitation')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'needs_review')),
  delivered_revision integer CHECK (delivered_revision > 0),
  telegram_chat_id bigint,
  telegram_message_id bigint CHECK (telegram_message_id > 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retry_at timestamptz,
  error_code text CHECK (char_length(error_code) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, kind),
  CHECK (status <> 'delivered' OR (telegram_chat_id IS NOT NULL AND telegram_message_id IS NOT NULL)),
  CHECK (kind <> 'publication' OR status <> 'delivered' OR delivered_revision IS NOT NULL)
);

CREATE INDEX reception_applications_participant_idx ON reception_applications(participant_id)
  WHERE participant_id IS NOT NULL;
CREATE INDEX reception_application_deliveries_pending_idx ON reception_application_deliveries(retry_at, created_at)
  WHERE status = 'pending';
