-- Reputation counter, step 2: remembers when the operator was last signalled about a person,
-- so the signal is sent once per person per 30 days.
CREATE TABLE IF NOT EXISTS trh_rep_alerts (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    alerted_at BIGINT UNSIGNED NOT NULL,
    dislikers INT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
