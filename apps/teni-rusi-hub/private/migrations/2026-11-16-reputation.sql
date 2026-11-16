-- Reputation counter (step 1): who wrote which message in the hub group (number and author only,
-- no text, kept without expiry by decision) and who reacted to it with a like or a dislike.
-- Nothing here is shown to people except their own totals.
CREATE TABLE IF NOT EXISTS trh_group_messages (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    message_id BIGINT NOT NULL,
    author_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, message_id),
    INDEX trh_group_messages_author (hub_id, author_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS trh_reactions (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    message_id BIGINT NOT NULL,
    reactor_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    author_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sign TINYINT NOT NULL,
    updated_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, message_id, reactor_id),
    INDEX trh_reactions_author (hub_id, author_id, sign)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
