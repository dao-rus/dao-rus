-- Telegram event dates have only second precision. update_id breaks ties
-- and protects against stale webhook retries.
ALTER TABLE telegram_hub_reactions
  ADD COLUMN telegram_update_id bigint NOT NULL DEFAULT 0;
