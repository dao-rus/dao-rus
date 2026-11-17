-- Departure list: who left the hub group and when. kind: «left» (the person left) or «removed»
-- (banned, or removed by an administrator). Read by the operator with /left; nobody else sees it.
CREATE TABLE IF NOT EXISTS trh_departures (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    left_at BIGINT UNSIGNED NOT NULL,
    kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    by_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NULL,
    PRIMARY KEY (hub_id, user_id, left_at),
    INDEX trh_departures_time (hub_id, left_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
