CREATE TABLE code_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key text NOT NULL CHECK (section_key IN ('dao-code-1', 'dao-code-2', 'dao-code-3', 'dao-code-all')),
  author_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  parent_id uuid REFERENCES code_comments(id) ON DELETE RESTRICT,
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  hidden_at timestamptz,
  hidden_by uuid REFERENCES participants(id) ON DELETE RESTRICT,
  hidden_reason text,
  pinned_at timestamptz,
  pinned_by uuid REFERENCES participants(id) ON DELETE RESTRICT,
  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK ((deleted_at IS NULL AND body IS NOT NULL AND char_length(btrim(body)) BETWEEN 1 AND 2000)
      OR (deleted_at IS NOT NULL AND body IS NULL)),
  CHECK ((hidden_at IS NULL AND hidden_by IS NULL AND hidden_reason IS NULL)
      OR (hidden_at IS NOT NULL AND hidden_by IS NOT NULL AND hidden_reason IS NOT NULL
          AND char_length(btrim(hidden_reason)) BETWEEN 1 AND 500)),
  CHECK ((pinned_at IS NULL AND pinned_by IS NULL)
      OR (pinned_at IS NOT NULL AND pinned_by IS NOT NULL)),
  CHECK (parent_id IS NULL OR pinned_at IS NULL)
);

CREATE INDEX code_comments_section_idx
  ON code_comments(section_key, parent_id, created_at DESC, id DESC);
CREATE INDEX code_comments_author_created_idx
  ON code_comments(author_id, created_at DESC);

CREATE FUNCTION validate_code_comment_parent() RETURNS trigger AS $$
DECLARE parent_section text;
DECLARE grandparent_id uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
  SELECT section_key, parent_id INTO parent_section, grandparent_id
    FROM code_comments WHERE id = NEW.parent_id FOR SHARE;
  IF NOT FOUND OR parent_section <> NEW.section_key OR grandparent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid code comment parent';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER code_comments_parent_guard
  BEFORE INSERT OR UPDATE OF parent_id, section_key ON code_comments
  FOR EACH ROW EXECUTE FUNCTION validate_code_comment_parent();

CREATE TABLE code_comment_helpful (
  comment_id uuid NOT NULL REFERENCES code_comments(id) ON DELETE RESTRICT,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, participant_id)
);
