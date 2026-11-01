-- Keep tombstones for removed reactions: late Telegram updates must not resurrect them.
ALTER TABLE telegram_hub_reactions
  DROP CONSTRAINT telegram_hub_reactions_reaction_check;
ALTER TABLE telegram_hub_reactions
  ALTER COLUMN reaction DROP NOT NULL;
ALTER TABLE telegram_hub_reactions
  ADD CONSTRAINT telegram_hub_reactions_reaction_check
    CHECK (reaction IS NULL OR reaction IN ('👍', '👎'));
ALTER TABLE telegram_hub_reactions
  ADD COLUMN event_date bigint NOT NULL DEFAULT 0;
CREATE INDEX telegram_hub_reactions_event_date_idx
  ON telegram_hub_reactions(hub_id, message_author_id, event_date)
  WHERE reaction = '👎';
