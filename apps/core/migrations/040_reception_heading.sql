-- A relayed photo or voice message arrives in the forum as two messages: the "От: …" line and
-- the copy. Remember the first one too, so a reply to either reaches the person.
ALTER TABLE reception_relay_updates ADD COLUMN forum_heading_message_id bigint;

CREATE INDEX reception_relay_forum_heading_idx
  ON reception_relay_updates(forum_chat_id, forum_heading_message_id)
  WHERE forum_heading_message_id IS NOT NULL;
