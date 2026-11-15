-- Import ONCE into a dedicated empty MySQL database, not a Core/Lenta database.
-- InnoDB transactions and row locks are required. All times are Unix UTC seconds.
CREATE TABLE trh_requests (
    id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_update_id BIGINT UNSIGNED NOT NULL UNIQUE,
    user_chat_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_date BIGINT UNSIGNED NOT NULL,
    expires_at BIGINT UNSIGNED NOT NULL,
    code_version VARCHAR(20) NOT NULL,
    status ENUM('pending','approval_pending','decline_pending','approved','declined','superseded','needs_review') NOT NULL DEFAULT 'pending',
    decision_reason ENUM('accepted','refused','expired') NULL,
    accepted_at BIGINT UNSIGNED NULL,
    outcome VARCHAR(32) NULL,
    offer_state ENUM('queued','awaiting_start','sent','none') NOT NULL DEFAULT 'queued',
    offer_target VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    offer_attempts INT UNSIGNED NOT NULL DEFAULT 0,
    offer_due_at BIGINT UNSIGNED NOT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    retry_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
    error_code VARCHAR(48) NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    INDEX trh_pending (hub_id, status, expires_at),
    INDEX trh_decisions (hub_id, status, retry_at),
    INDEX trh_offers (hub_id, offer_state, offer_due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One lock/ordering slot per Telegram identity in a hub, shared by webhook/cron.
CREATE TABLE trh_slots (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    latest_date BIGINT UNSIGNED NOT NULL DEFAULT 0,
    latest_update BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_start_date BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_start_update BIGINT UNSIGNED NULL,
    current_request_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    PRIMARY KEY (hub_id, telegram_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Immutable acceptance evidence; no DAO account, membership, verification or trust.
CREATE TABLE trh_consents (
    request_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    code_version VARCHAR(20) NOT NULL,
    accepted_at BIGINT UNSIGNED NOT NULL,
    FOREIGN KEY (request_id) REFERENCES trh_requests(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trh_memberships (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    latest_consent_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (hub_id, telegram_user_id),
    FOREIGN KEY (latest_consent_id) REFERENCES trh_consents(request_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Added 2026-11-15 (migrations/2026-11-15-relays.sql): operator message -> sender, for replies.
CREATE TABLE trh_relays (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    operator_message_id BIGINT UNSIGNED NOT NULL,
    sender_chat_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, operator_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Added 2026-11-15 (migrations/2026-11-15-community.sql): names, exclusion marks, Exchange.
CREATE TABLE trh_people (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    first_name VARCHAR(255) NOT NULL DEFAULT '',
    last_name VARCHAR(255) NULL,
    username VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    updated_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, telegram_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE trh_exclusions (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    excluded_at BIGINT UNSIGNED NOT NULL,
    excluded_by VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    times INT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (hub_id, telegram_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE trh_signals (
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
CREATE TABLE trh_dialogs (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    state ENUM('need','have') NOT NULL,
    updated_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, telegram_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
