-- Existing proposals stay public. Visibility is fixed at publication.
ALTER TABLE proposals ADD COLUMN author_visibility text NOT NULL DEFAULT 'public' CHECK(author_visibility IN ('public','anonymous'));
CREATE FUNCTION veche_author_visibility_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.author_visibility IS DISTINCT FROM NEW.author_visibility THEN RAISE EXCEPTION 'Author visibility is immutable'; END IF;
 IF NEW.author_visibility='anonymous' AND NEW.poll_circle IS NULL THEN RAISE EXCEPTION 'Anonymous publication requires a poll'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proposals_author_visibility_guard BEFORE INSERT OR UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION veche_author_visibility_guard();
CREATE FUNCTION veche_public_creation_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p proposals;
BEGIN
 IF NEW.event_type='proposal.created' THEN
  SELECT * INTO p FROM proposals WHERE id::text=NEW.payload->>'proposal_id';
  IF p.author_visibility='anonymous' THEN
   NEW.participant_id:=NULL;
   NEW.payload:=jsonb_build_object('proposal_id',p.id,'title',p.title);
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER events_veche_public_guard BEFORE INSERT OR UPDATE ON events FOR EACH ROW EXECUTE FUNCTION veche_public_creation_event();
-- Audit primitives remain internal. Caller-facing books must use this projection.
CREATE FUNCTION darus_visible_book(target uuid,viewer uuid)
RETURNS TABLE(id uuid,amount numeric,currency text,kind text,source_type text,source_id uuid,hold_id uuid,created_at timestamptz)
LANGUAGE sql STABLE AS $$
 SELECT b.id,b.amount,b.currency,b.kind,b.source_type,
 CASE WHEN p.author_visibility='anonymous' AND viewer IS DISTINCT FROM p.author_participant_id THEN NULL ELSE b.source_id END,
 CASE WHEN p.author_visibility='anonymous' AND viewer IS DISTINCT FROM p.author_participant_id THEN NULL ELSE b.hold_id END,b.created_at
 FROM darus_book b LEFT JOIN darus_holds h ON h.id=b.hold_id
 LEFT JOIN proposals p ON p.id=COALESCE(h.source_id,b.source_id)
 WHERE b.participant_id=target AND NOT (b.kind='hold' AND COALESCE(p.author_visibility='anonymous',false) AND viewer IS DISTINCT FROM p.author_participant_id)
 ORDER BY b.created_at DESC,b.id DESC
$$;
