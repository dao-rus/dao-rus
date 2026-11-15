-- Switchboard step 1 (docs/architecture/switchboard-protocol-v0.md). Applied by
-- bin/migrate-2026-11-16.php, which checks what exists and applies only what is missing.
ALTER TABLE trh_signals MODIFY kind ENUM('need','have','do','interest') NOT NULL;
ALTER TABLE trh_signals ADD COLUMN city VARCHAR(100) NULL;
ALTER TABLE trh_signals ADD COLUMN visibility ENUM('open','match') NOT NULL DEFAULT 'open';
ALTER TABLE trh_signals ADD COLUMN expires_at BIGINT UNSIGNED NULL;
UPDATE trh_signals SET expires_at = created_at + 7776000 WHERE expires_at IS NULL;
ALTER TABLE trh_dialogs MODIFY state VARCHAR(80) NOT NULL;
CREATE TABLE IF NOT EXISTS trh_net (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    accepted_at BIGINT UNSIGNED NOT NULL,
    code_version VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    about VARCHAR(200) NULL,
    status ENUM('active','disconnected') NOT NULL DEFAULT 'active',
    cleared_at BIGINT UNSIGNED NULL,
    PRIMARY KEY (hub_id, telegram_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS trh_links (
    id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    from_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    to_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    entry_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status ENUM('requested','offered','shown','connected','declined') NOT NULL,
    query VARCHAR(200) NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    decided_at BIGINT UNSIGNED NULL,
    connected_at BIGINT UNSIGNED NULL,
    asked_from TINYINT NOT NULL DEFAULT 0,
    asked_to TINYINT NOT NULL DEFAULT 0,
    UNIQUE KEY trh_links_once (hub_id, from_id, entry_id),
    INDEX trh_links_to (hub_id, to_id, status),
    INDEX trh_links_review (hub_id, status, connected_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS trh_reviews (
    id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    link_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    from_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    to_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    verdict ENUM('useful','neutral','violation') NOT NULL,
    code_point TINYINT NULL,
    note VARCHAR(300) NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    UNIQUE KEY trh_reviews_once (link_id, from_id),
    INDEX trh_reviews_to (hub_id, to_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS trh_usage (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    day INT UNSIGNED NOT NULL,
    action VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    n INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (hub_id, telegram_user_id, day, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
