-- «Ближе» (signal type `dating`): explicit match keys chosen by the author.
-- Free text never takes part in matching; a record without keys does not match.
CREATE TABLE closer_goals (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  display_name text NOT NULL CHECK (btrim(display_name) <> '' AND char_length(display_name) <= 60),
  asks_gender boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0
);

INSERT INTO closer_goals(key, display_name, asks_gender, position) VALUES
  ('friend', 'Друг', false, 10), ('relationship', 'Отношения', true, 20),
  ('family', 'Семья', true, 30), ('support', 'Поддержка', false, 40),
  ('likeminded', 'Единомышленники', false, 50);

-- The city itself is not copied: "my city" always means the author's current residence.
CREATE TABLE signal_closer_keys (
  signal_id uuid PRIMARY KEY REFERENCES profile_signals(id) ON DELETE CASCADE,
  goal_key text NOT NULL REFERENCES closer_goals(key),
  any_city boolean NOT NULL,
  self_gender text CHECK (self_gender IN ('m', 'f')),
  seeks_gender text CHECK (seeks_gender IN ('m', 'f', 'any')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX signal_closer_keys_goal_idx ON signal_closer_keys(goal_key);

CREATE FUNCTION guard_signal_closer_keys() RETURNS trigger AS $$
BEGIN
  PERFORM 1 FROM profile_signals WHERE id = NEW.signal_id AND kind = 'dating';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Closer keys belong only to dating signals' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER signal_closer_keys_guard
  BEFORE INSERT OR UPDATE ON signal_closer_keys
  FOR EACH ROW EXECUTE FUNCTION guard_signal_closer_keys();

-- A participant cannot map the hidden section by holding a record for every goal.
-- The lock makes the count effective across concurrent inserts of one participant.
CREATE FUNCTION limit_closer_signals() RETURNS trigger AS $$
BEGIN
  IF NEW.kind = 'dating' AND NEW.status = 'active' THEN
    PERFORM pg_advisory_xact_lock(hashtext('closer:' || NEW.participant_id::text));
    IF (SELECT count(*) FROM profile_signals
         WHERE participant_id = NEW.participant_id AND kind = 'dating' AND status = 'active') >= 3 THEN
      RAISE EXCEPTION 'Closer signal limit reached' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profile_signal_closer_limit
  BEFORE INSERT ON profile_signals
  FOR EACH ROW EXECUTE FUNCTION limit_closer_signals();
