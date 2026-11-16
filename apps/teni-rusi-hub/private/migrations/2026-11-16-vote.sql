-- Vote on excluding a person from the group. The ballot is secret: trh_vote_ballots only says that a person
-- voted (no choice, no time), the choices exist only as the two totals in trh_votes.
CREATE TABLE IF NOT EXISTS trh_votes (
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
CREATE TABLE IF NOT EXISTS trh_vote_rolls (
    vote_id CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (vote_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS trh_vote_ballots (
    vote_id CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (vote_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- People the operator confirmed as participants who may vote without having accepted the rules in the bot
-- (those added to the group earlier, known to be members of the DAO).
CREATE TABLE IF NOT EXISTS trh_voters (
    hub_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    added_at BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (hub_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
