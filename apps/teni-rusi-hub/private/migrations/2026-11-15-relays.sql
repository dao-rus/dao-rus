-- Remembers which messages the bot passed to the operator, so an operator reply
-- (Telegram "Reply" to that message) can be delivered back to the sender.
CREATE TABLE IF NOT EXISTS trh_relays (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    operator_message_id BIGINT UNSIGNED NOT NULL,
    sender_chat_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, operator_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
