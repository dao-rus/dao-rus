ALTER TABLE slovotvor_words
  ADD COLUMN parent_id uuid REFERENCES slovotvor_words(id) ON DELETE RESTRICT;

ALTER TABLE slovotvor_words
  ADD CONSTRAINT slovotvor_words_parent_check
    CHECK (parent_id IS NULL OR (word IS NOT NULL AND parent_id <> id));

CREATE INDEX slovotvor_words_parent_id_idx
  ON slovotvor_words (parent_id, created_at DESC, id DESC);
