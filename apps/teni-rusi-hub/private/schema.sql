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
