ALTER TABLE notification_deliveries
  ADD COLUMN claimed_at timestamptz;

ALTER TABLE notification_deliveries
  DROP CONSTRAINT notification_deliveries_status_check;
ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_status_check
    CHECK (status IN ('pending', 'processing', 'sent', 'blocked', 'failed', 'unknown'));
ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_processing_claim_check
    CHECK (status <> 'processing' OR claimed_at IS NOT NULL);

CREATE INDEX notification_deliveries_pending_idx
  ON notification_deliveries(created_at, id)
  WHERE channel = 'telegram' AND status = 'pending';
CREATE INDEX notification_deliveries_processing_idx
  ON notification_deliveries(claimed_at)
  WHERE status = 'processing';
