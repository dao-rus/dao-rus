ALTER TABLE guardian_campaigns
  ALTER COLUMN action_label DROP NOT NULL,
  ALTER COLUMN action_url DROP NOT NULL;
