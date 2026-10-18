CREATE TABLE slovotvor_replacement_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_word text NOT NULL,
  author_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slovotvor_replacement_requests_source_length_check
    CHECK (char_length(btrim(source_word)) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX slovotvor_replacement_requests_source_word_idx
  ON slovotvor_replacement_requests (lower(btrim(source_word)));

CREATE INDEX slovotvor_replacement_requests_created_at_idx
  ON slovotvor_replacement_requests (created_at DESC, id DESC);
