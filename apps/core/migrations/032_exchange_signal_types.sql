-- Evolve profile_signals in place. Old bodies are copied verbatim, never summarized.
CREATE TABLE IF NOT EXISTS signal_types (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  enabled boolean NOT NULL DEFAULT true
);

INSERT INTO signal_types(key, display_name) VALUES
  ('need', 'Нужно'), ('search', 'Ищу'), ('can', 'Могу'), ('have', 'Есть'),
  ('want', 'Хочу'), ('know', 'Знаю'), ('skill', 'Умею'), ('doing', 'Делаю'),
  ('idea', 'Идея'), ('dating', 'Знакомства')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE profile_signals
  ADD COLUMN IF NOT EXISTS label text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS legacy_body boolean NOT NULL DEFAULT false;

-- Includes closed/archived signals and preserves UUIDs, timestamps and Relay FKs.
UPDATE profile_signals SET label = body, legacy_body = true WHERE label IS NULL;

ALTER TABLE profile_signals
  ALTER COLUMN label SET NOT NULL,
  DROP CONSTRAINT IF EXISTS profile_signals_kind_check,
  DROP CONSTRAINT IF EXISTS profile_signals_kind_fkey,
  DROP CONSTRAINT IF EXISTS profile_signals_content_check,
  DROP CONSTRAINT IF EXISTS profile_signals_body_projection_check;

ALTER TABLE profile_signals
  ADD CONSTRAINT profile_signals_kind_fkey FOREIGN KEY (kind) REFERENCES signal_types(key),
  ADD CONSTRAINT profile_signals_content_check CHECK (
    legacy_body OR (
      char_length(label) BETWEEN 1 AND 120 AND btrim(label) <> ''
      AND (description IS NULL OR (char_length(description) BETWEEN 1 AND 10000 AND btrim(description) <> ''))
    )
  ),
  ADD CONSTRAINT profile_signals_body_projection_check CHECK (
    body = label || CASE WHEN description IS NULL THEN '' ELSE E'\n\n' || description END
    AND (NOT legacy_body OR description IS NULL)
  );

-- label/description are canonical. body is a compatibility projection for old readers.
-- Body-only writes from /need and the existing editor remain supported explicitly.
CREATE OR REPLACE FUNCTION project_profile_signal_body() RETURNS trigger AS $$
DECLARE
  type_enabled boolean;
  from_body boolean := false;
  projected text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    from_body := NEW.label IS NULL;
    NEW.legacy_body := from_body;
  ELSE
    IF NEW.label IS DISTINCT FROM OLD.label OR NEW.description IS DISTINCT FROM OLD.description THEN
      NEW.legacy_body := false;
    ELSIF NEW.body IS DISTINCT FROM OLD.body THEN
      IF NOT OLD.legacy_body THEN
        RAISE EXCEPTION 'Structured signal body is read-only' USING ERRCODE = '23514';
      END IF;
      from_body := true;
      NEW.legacy_body := true;
    ELSE
      NEW.legacy_body := OLD.legacy_body;
    END IF;
  END IF;

  IF from_body THEN
    IF NEW.body IS NULL OR btrim(NEW.body) = '' OR char_length(NEW.body) > 500
       OR NEW.description IS NOT NULL OR NEW.kind NOT IN ('want', 'need', 'can', 'have') THEN
      RAISE EXCEPTION 'Invalid legacy signal body' USING ERRCODE = '23514';
    END IF;
    NEW.label := NEW.body;
    NEW.description := NULL;
  END IF;

  -- A type change is an explicit revision, not inherited unstructured content.
  IF TG_OP = 'UPDATE' AND NEW.kind IS DISTINCT FROM OLD.kind THEN
    NEW.legacy_body := false;
  END IF;

  projected := NEW.label || CASE WHEN NEW.description IS NULL THEN '' ELSE E'\n\n' || NEW.description END;
  IF TG_OP = 'INSERT' THEN
    IF NEW.body IS NOT NULL AND NEW.body IS DISTINCT FROM projected THEN
      RAISE EXCEPTION 'Conflicting signal content' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.body IS DISTINCT FROM OLD.body AND NEW.body IS DISTINCT FROM projected THEN
    RAISE EXCEPTION 'Conflicting signal content' USING ERRCODE = '23514';
  END IF;
  NEW.body := projected;

  IF TG_OP = 'INSERT' OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    SELECT enabled INTO type_enabled FROM signal_types WHERE key = NEW.kind FOR SHARE;
    IF NOT FOUND OR NOT type_enabled THEN
      RAISE EXCEPTION 'Unknown or disabled signal type' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profile_signal_body_projection ON profile_signals;
CREATE TRIGGER profile_signal_body_projection BEFORE INSERT OR UPDATE ON profile_signals
  FOR EACH ROW EXECUTE FUNCTION project_profile_signal_body();

COMMENT ON COLUMN profile_signals.body IS 'Compatibility projection of canonical label and description; synchronized by trigger.';
COMMENT ON COLUMN profile_signals.legacy_body IS 'Verbatim pre-structured body; exempt from label brevity until explicitly rewritten by the author.';
