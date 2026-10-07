-- Rewards that arrive while their owner is away (the first need/have reward comes when someone
-- else responds) are shown once at the owner's next visit. A row means "already shown".
CREATE TABLE reward_announcements (
  ledger_id uuid PRIMARY KEY REFERENCES darus_ledger(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  shown_at timestamptz NOT NULL DEFAULT now()
);

-- Everything granted before this release was seen at the time, or is old news.
INSERT INTO reward_announcements(ledger_id, participant_id)
SELECT id, participant_id FROM darus_ledger WHERE source_type IN ('need_first_created', 'have_first_created');
