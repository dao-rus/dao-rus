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
    kind ENUM('need','have','do','interest') NOT NULL,
    body VARCHAR(500) NOT NULL,
    city VARCHAR(100) NULL,
    visibility ENUM('open','match') NOT NULL DEFAULT 'open',
    expires_at BIGINT UNSIGNED NULL,
    warned_at BIGINT UNSIGNED NULL,
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
    state VARCHAR(80) NOT NULL,
    updated_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, telegram_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Added 2026-11-16 (migrations/2026-11-16-switchboard.sql): switchboard step 1.
CREATE TABLE trh_net (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    accepted_at BIGINT UNSIGNED NOT NULL,
    code_version VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    about VARCHAR(200) NULL,
    status ENUM('active','disconnected') NOT NULL DEFAULT 'active',
    cleared_at BIGINT UNSIGNED NULL,
    notify TINYINT NOT NULL DEFAULT 1,
    PRIMARY KEY (hub_id, telegram_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE trh_links (
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
CREATE TABLE trh_reviews (
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
CREATE TABLE trh_usage (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    day INT UNSIGNED NOT NULL,
    action VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    n INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (hub_id, telegram_user_id, day, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trh_keys (
    hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    telegram_user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    tail CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    last_used_at BIGINT UNSIGNED NULL,
    revoked_at BIGINT UNSIGNED NULL,
    KEY trh_keys_user (hub_id, telegram_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reputation counter: group message authors (number and author only, no text) and reactions.
CREATE TABLE trh_group_messages (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    message_id BIGINT NOT NULL,
    author_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, message_id),
    INDEX trh_group_messages_author (hub_id, author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trh_reactions (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    message_id BIGINT NOT NULL,
    reactor_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    author_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sign TINYINT NOT NULL,
    updated_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, message_id, reactor_id),
    INDEX trh_reactions_author (hub_id, author_id, sign)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reputation counter, step 2: when the operator was last signalled about a person.
CREATE TABLE trh_rep_alerts (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    alerted_at BIGINT UNSIGNED NOT NULL,
    dislikers INT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Vote on excluding a person (migrations/2026-11-16-vote.sql).
CREATE TABLE trh_votes (
    id CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    subject_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    ends_at BIGINT UNSIGNED NOT NULL DEFAULT 0,
    roll_n INT UNSIGNED NOT NULL DEFAULT 0,
    quorum INT UNSIGNED NOT NULL DEFAULT 0,
    yes_n INT UNSIGNED NOT NULL DEFAULT 0,
    no_n INT UNSIGNED NOT NULL DEFAULT 0,
    message_id BIGINT NULL,
    outcome VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NULL,
    INDEX trh_votes_status (hub_id, status, ends_at),
    INDEX trh_votes_subject (hub_id, subject_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE trh_vote_rolls (
    vote_id CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (vote_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE trh_vote_ballots (
    vote_id CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (vote_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- People the operator confirmed as participants who may vote without having accepted the rules in the bot
-- (those added to the group earlier, known to be members of the DAO).
CREATE TABLE trh_voters (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    added_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
