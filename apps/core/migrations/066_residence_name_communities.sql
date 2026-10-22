-- The participant's supplied place name is the sole geographical key.
-- Retain legacy metadata and immutable audience snapshots for compatibility.
ALTER TABLE participants DROP CONSTRAINT participants_residence_shape_check;
COMMENT ON COLUMN participants.residence_type IS 'Legacy metadata; not used for geographical identity or filtering';
COMMENT ON COLUMN participants.residence_country IS 'Legacy metadata; not used for geographical identity or filtering';

CREATE INDEX participants_residence_name_lookup_idx
  ON participants (lower(btrim(residence_name)))
  WHERE NULLIF(btrim(residence_name), '') IS NOT NULL;
DROP INDEX participants_residence_lookup_idx;

LOCK TABLE community_post_targets IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE residence_target_conversion ON COMMIT DROP AS
SELECT post_id, community_key AS old_key,
       lower(btrim(CASE WHEN left(btrim(community_key), 1) = '['
         THEN community_key::jsonb ->> 2 ELSE community_key END)) AS new_key
  FROM community_post_targets WHERE community_type = 'residence';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM residence_target_conversion WHERE new_key IS NULL OR new_key = '') THEN
    RAISE EXCEPTION 'Cannot identify the place of a historical community announcement';
  END IF;
END $$;

-- Merge placements, keeping the original posts, authors and history intact.
INSERT INTO community_post_targets(post_id, community_type, community_key)
SELECT DISTINCT post_id, 'residence', new_key FROM residence_target_conversion
ON CONFLICT DO NOTHING;

DELETE FROM community_post_targets target USING residence_target_conversion source
 WHERE target.post_id = source.post_id AND target.community_type = 'residence'
   AND target.community_key = source.old_key AND source.old_key <> source.new_key;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM residence_target_conversion source
     WHERE NOT EXISTS (SELECT 1 FROM community_post_targets target
       WHERE target.post_id = source.post_id AND target.community_type = 'residence'
         AND target.community_key = source.new_key)
  ) THEN
    RAISE EXCEPTION 'A geographical announcement placement was lost';
  END IF;
END $$;
