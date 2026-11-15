-- Active bot: per-kind life of records, expiry warning, opt-out of match notices.
ALTER TABLE trh_signals ADD COLUMN warned_at BIGINT UNSIGNED NULL;
ALTER TABLE trh_net ADD COLUMN notify TINYINT NOT NULL DEFAULT 1;
UPDATE trh_signals SET expires_at = NULL WHERE kind = 'interest' AND status = 'active';
UPDATE trh_signals SET expires_at = created_at + 15552000 WHERE kind = 'do' AND status = 'active' AND expires_at = created_at + 7776000;
