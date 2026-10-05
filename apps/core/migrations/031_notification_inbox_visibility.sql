ALTER TABLE notifications
  ADD COLUMN visible_in_inbox boolean NOT NULL DEFAULT true;

CREATE INDEX notifications_visible_unread_idx
  ON notifications(participant_id, created_at DESC, id DESC)
  WHERE visible_in_inbox AND read_at IS NULL;
