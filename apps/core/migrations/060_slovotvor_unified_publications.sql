ALTER TABLE slovotvor_words
  ALTER COLUMN word DROP NOT NULL,
  ALTER COLUMN source_word DROP NOT NULL;

DROP INDEX IF EXISTS slovotvor_words_word_source_idx;

CREATE UNIQUE INDEX slovotvor_words_word_source_pair_idx
  ON slovotvor_words (lower(btrim(word)), lower(btrim(source_word)))
  WHERE word IS NOT NULL AND source_word IS NOT NULL;

CREATE UNIQUE INDEX slovotvor_words_word_only_idx
  ON slovotvor_words (lower(btrim(word)))
  WHERE word IS NOT NULL AND source_word IS NULL;

CREATE UNIQUE INDEX slovotvor_words_source_only_idx
  ON slovotvor_words (lower(btrim(source_word)))
  WHERE word IS NULL AND source_word IS NOT NULL;

CREATE UNIQUE INDEX slovotvor_words_explanation_only_idx
  ON slovotvor_words (lower(btrim(explanation)))
  WHERE word IS NULL AND source_word IS NULL AND explanation IS NOT NULL;

ALTER TABLE slovotvor_words
  ADD CONSTRAINT slovotvor_words_publication_content_check
    CHECK (word IS NOT NULL OR source_word IS NOT NULL OR explanation IS NOT NULL);

INSERT INTO slovotvor_words(word, source_word, explanation, author_participant_id, slug, created_at)
SELECT NULL, r.source_word, NULL, r.author_participant_id,
       'slovo-' || replace(r.id::text, '-', ''), r.created_at
  FROM slovotvor_replacement_requests r
 ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS slovotvor_replacement_requests;
