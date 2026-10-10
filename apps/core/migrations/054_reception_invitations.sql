-- The invitation row records a human decision independently of delivery and membership.
ALTER TABLE reception_application_deliveries
  ADD COLUMN requested_by uuid REFERENCES participants(id) ON DELETE SET NULL,
  ADD COLUMN requested_at timestamptz,
  ADD COLUMN invitation_forum_chat_id bigint;

CREATE INDEX reception_invitation_claim_idx ON reception_application_deliveries(claimed_at)
  WHERE kind='invitation' AND status='processing';
