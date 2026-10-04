CREATE TABLE guardian_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_key text NOT NULL UNIQUE CHECK (length(btrim(campaign_key)) > 0),
  campaign_type text NOT NULL CHECK (length(btrim(campaign_type)) > 0),
  text text NOT NULL CHECK (length(btrim(text)) > 0),
  action_label text NOT NULL CHECK (length(btrim(action_label)) > 0),
  action_url text NOT NULL CHECK (length(btrim(action_url)) > 0),
  audience_rule jsonb NOT NULL,
  created_by_participant_id uuid NOT NULL REFERENCES participants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  recipient_count integer NOT NULL CHECK (recipient_count >= 0),
  telegram_delivery_count integer NOT NULL
    CHECK (telegram_delivery_count >= 0 AND telegram_delivery_count <= recipient_count)
);

CREATE FUNCTION reject_guardian_campaign_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Guardian campaign snapshots are immutable';
END;
$$;

CREATE TRIGGER guardian_campaigns_immutable
  BEFORE UPDATE OR DELETE ON guardian_campaigns
  FOR EACH ROW EXECUTE FUNCTION reject_guardian_campaign_mutation();

ALTER TABLE notifications
  ADD COLUMN campaign_id uuid REFERENCES guardian_campaigns(id),
  ADD COLUMN action_label text CHECK (action_label IS NULL OR length(btrim(action_label)) > 0);

CREATE UNIQUE INDEX notifications_campaign_participant_idx
  ON notifications(campaign_id, participant_id)
  WHERE campaign_id IS NOT NULL;
