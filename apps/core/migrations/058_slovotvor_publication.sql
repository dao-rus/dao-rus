ALTER TABLE slovotvor_words
  ADD CONSTRAINT slovotvor_words_word_length_check
    CHECK (char_length(btrim(word)) BETWEEN 1 AND 120),
  ADD CONSTRAINT slovotvor_words_source_word_length_check
    CHECK (char_length(btrim(source_word)) BETWEEN 1 AND 120),
  ADD CONSTRAINT slovotvor_words_explanation_length_check
    CHECK (explanation IS NULL OR char_length(btrim(explanation)) BETWEEN 1 AND 10000),
  ADD CONSTRAINT slovotvor_words_slug_length_check
    CHECK (char_length(btrim(slug)) BETWEEN 1 AND 120);

CREATE TABLE slovotvor_users (
  participant_id uuid PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
