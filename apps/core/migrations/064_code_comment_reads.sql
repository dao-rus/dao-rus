CREATE TABLE code_comment_reads (
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  comment_id uuid NOT NULL REFERENCES code_comments(id) ON DELETE RESTRICT,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_id, comment_id)
);
