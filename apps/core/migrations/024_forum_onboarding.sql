CREATE TABLE participant_forum_onboarding (
  participant_id uuid PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  forum_status text NOT NULL CHECK (forum_status IN ('joined', 'absent')),
  observed_at timestamptz NOT NULL,
  invitation_attempted_at timestamptz,
  invitation_sent_at timestamptz,
  invitation_blocked_at timestamptz,
  CHECK (invitation_sent_at IS NULL OR invitation_attempted_at IS NOT NULL)
);
