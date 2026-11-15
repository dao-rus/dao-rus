-- Minimal community functions while DAO Core is unavailable: names for the operator's
-- list, exclusion marks, Exchange records and the pending "write your record" state.
CREATE TABLE IF NOT EXISTS trh_people (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    first_name VARCHAR(255) NOT NULL DEFAULT '',
    last_name VARCHAR(255) NULL,
    username VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    updated_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, telegram_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS trh_exclusions (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    excluded_at BIGINT UNSIGNED NOT NULL,
    excluded_by VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    times INT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (hub_id, telegram_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS trh_signals (
    id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    kind ENUM('need','have') NOT NULL,
    body VARCHAR(500) NOT NULL,
    status ENUM('active','archived') NOT NULL DEFAULT 'active',
    group_message_id BIGINT NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    archived_at BIGINT UNSIGNED NULL,
    INDEX trh_signals_list (hub_id, status, created_at),
    INDEX trh_signals_owner (hub_id, telegram_user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS trh_dialogs (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    state ENUM('need','have') NOT NULL,
    updated_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, telegram_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
