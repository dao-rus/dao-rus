-- Keys for programs and AI assistants (switchboard step 2). Only a SHA-256 fingerprint is stored.
CREATE TABLE IF NOT EXISTS trh_keys (
    hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    tail CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    last_used_at BIGINT UNSIGNED NULL,
    revoked_at BIGINT UNSIGNED NULL,
    KEY trh_keys_user (hub_id, telegram_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
