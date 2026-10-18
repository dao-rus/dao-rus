CREATE TABLE slovotvor_words (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word text NOT NULL CHECK (length(btrim(word)) > 0),
  source_word text NOT NULL CHECK (length(btrim(source_word)) > 0),
  explanation text,
  author_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  slug text NOT NULL UNIQUE CHECK (length(btrim(slug)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX slovotvor_words_word_source_idx
  ON slovotvor_words (lower(btrim(word)), lower(btrim(source_word)));

CREATE INDEX slovotvor_words_created_at_idx
  ON slovotvor_words (created_at DESC, id DESC);
