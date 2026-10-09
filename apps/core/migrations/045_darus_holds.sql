-- Additive extension: the minting ledger and all historical rows stay untouched.
CREATE TABLE darus_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  amount numeric(20,6) NOT NULL CHECK (amount > 0),
  source_type text NOT NULL CHECK (source_type ~ '^[a-z][a-z0-9_.:]{0,63}$'),
  source_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (source_type, source_id, participant_id)
);
CREATE TABLE darus_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  hold_id uuid NOT NULL REFERENCES darus_holds(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('hold', 'distribution', 'refund')),
  amount numeric(20,6) NOT NULL,
  source_type text NOT NULL CHECK (source_type ~ '^[a-z][a-z0-9_.:]{0,63}$'),
  source_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((kind = 'hold' AND amount < 0) OR (kind <> 'hold' AND amount > 0)),
  UNIQUE (source_type, source_id, participant_id)
);
CREATE UNIQUE INDEX darus_hold_debit_once ON darus_movements(hold_id) WHERE kind = 'hold';
CREATE INDEX darus_movements_hold ON darus_movements(hold_id);
CREATE INDEX darus_movements_participant ON darus_movements(participant_id, created_at DESC, id DESC);

CREATE VIEW darus_book AS
 SELECT id, participant_id, amount, currency, source_type,
        COALESCE(source_attestation_id, source_subject_id) AS source_id,
        NULL::uuid AS hold_id, 'mint'::text AS kind, created_at FROM darus_ledger
 UNION ALL
 SELECT id, participant_id, amount, 'DARUS', source_type, source_id, hold_id, kind, created_at FROM darus_movements;

CREATE FUNCTION check_darus_movement() RETURNS trigger AS $$
DECLARE
  held darus_holds%ROWTYPE;
  available numeric;
BEGIN
  -- Serialize every release from this object, including direct SQL writers.
  SELECT * INTO held FROM darus_holds WHERE id = NEW.hold_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DARUS hold does not exist'; END IF;
  IF NEW.kind = 'hold' THEN
    IF NEW.participant_id <> held.participant_id OR NEW.amount <> -held.amount
       OR NEW.source_type <> held.source_type OR NEW.source_id <> held.source_id THEN
      RAISE EXCEPTION 'Invalid DARUS hold debit';
    END IF;
    PERFORM 1 FROM participants WHERE id = NEW.participant_id FOR UPDATE;
    SELECT COALESCE(sum(amount),0) INTO available FROM darus_book WHERE participant_id = NEW.participant_id;
    IF available + NEW.amount < 0 THEN RAISE EXCEPTION 'Insufficient DARUS balance'; END IF;
  ELSE
    IF NEW.kind = 'refund' AND NEW.participant_id <> held.participant_id THEN
      RAISE EXCEPTION 'DARUS refund must return to the holder';
    END IF;
    SELECT -COALESCE(sum(amount),0) INTO available FROM darus_movements WHERE hold_id = NEW.hold_id;
    IF NEW.amount > available THEN RAISE EXCEPTION 'Insufficient held DARUS'; END IF;
    -- Consistent with debits: every mutation of a participant's balance locks that participant.
    PERFORM 1 FROM participants WHERE id = NEW.participant_id FOR UPDATE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER darus_movements_check BEFORE INSERT ON darus_movements FOR EACH ROW EXECUTE FUNCTION check_darus_movement();

CREATE FUNCTION debit_new_darus_hold() RETURNS trigger AS $$
BEGIN
  INSERT INTO darus_movements(participant_id, hold_id, kind, amount, source_type, source_id)
  VALUES(NEW.participant_id, NEW.id, 'hold', -NEW.amount, NEW.source_type, NEW.source_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER darus_holds_debit AFTER INSERT ON darus_holds FOR EACH ROW EXECUTE FUNCTION debit_new_darus_hold();
CREATE TRIGGER darus_holds_append_only BEFORE UPDATE OR DELETE ON darus_holds FOR EACH ROW EXECUTE FUNCTION forbid_tokenization_record_change();
CREATE TRIGGER darus_movements_append_only BEFORE UPDATE OR DELETE ON darus_movements FOR EACH ROW EXECUTE FUNCTION forbid_tokenization_record_change();
CREATE TRIGGER darus_holds_no_truncate BEFORE TRUNCATE ON darus_holds EXECUTE FUNCTION forbid_tokenization_record_change();
CREATE TRIGGER darus_movements_no_truncate BEFORE TRUNCATE ON darus_movements EXECUTE FUNCTION forbid_tokenization_record_change();
