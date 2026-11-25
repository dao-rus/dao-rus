-- Reputation news in the hub group (decision of 25 Nov 2026): one summary per person an hour after the first
-- change, in reply to the message that got the reaction, deleted from the group after 5 minutes.
-- The topic of a group message is kept so the summary lands in the same topic (forum groups).
ALTER TABLE trh_group_messages ADD COLUMN thread_id BIGINT NULL;
-- Changes waiting for their summary: the net change only (likes minus dislikes), never who reacted.
CREATE TABLE IF NOT EXISTS trh_rep_news (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    delta INT NOT NULL,
    message_id BIGINT NOT NULL,
    thread_id BIGINT NULL,
    started_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- The bot's own summaries in the group, until they are deleted.
CREATE TABLE IF NOT EXISTS trh_rep_posts (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    message_id BIGINT NOT NULL,
    delete_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
