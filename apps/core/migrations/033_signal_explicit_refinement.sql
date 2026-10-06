-- Explicit structured confirmation may clear legacy_body even when content is unchanged.
-- Existing content CHECK still enforces label brevity; no data is rewritten.
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
      NEW.legacy_body := OLD.legacy_body AND NEW.legacy_body;
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
