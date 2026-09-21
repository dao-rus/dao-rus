ALTER TABLE external_identities
  ADD COLUMN oidc_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN bot_profile jsonb NOT NULL DEFAULT '{}'::jsonb;
