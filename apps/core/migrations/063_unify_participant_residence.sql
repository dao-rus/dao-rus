-- residence_name is the canonical participant-provided place text.
-- residence_type/country are optional structured coordinates used only when
-- the place is sufficiently identified for a geographic community.
CREATE TABLE participant_residence_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  profile_city text NOT NULL,
  residence_name text NOT NULL,
  residence_type text,
  residence_country text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX participant_residence_conflicts_open_idx
  ON participant_residence_conflicts(participant_id) WHERE status = 'open';

ALTER TABLE participants DROP CONSTRAINT participants_residence_complete;
ALTER TABLE participants ADD CONSTRAINT participants_residence_shape_check CHECK (
  (residence_name IS NULL AND residence_type IS NULL AND residence_country IS NULL)
  OR (
    residence_name IS NOT NULL
    AND ((residence_type IS NULL AND residence_country IS NULL)
      OR (residence_type IS NOT NULL AND residence_country IS NOT NULL))
  )
);

-- A legacy profile city becomes the canonical free-text residence only when
-- the established residence value is empty. Existing structured residence
-- values remain untouched; disagreements are preserved for manual review.
INSERT INTO participant_residence_conflicts
  (participant_id, profile_city, residence_name, residence_type, residence_country)
SELECT id, profile_city, residence_name, residence_type, residence_country
  FROM participants
 WHERE NULLIF(btrim(profile_city), '') IS NOT NULL
   AND NULLIF(btrim(residence_name), '') IS NOT NULL
   AND lower(btrim(profile_city)) <> lower(btrim(residence_name));

-- Backfill must not replay the live residence onboarding reward for historical
-- values that were already supplied before this migration.
ALTER TABLE participants DISABLE TRIGGER onboarding_residence;

UPDATE participants
   SET residence_name = profile_city,
       updated_at = now()
 WHERE NULLIF(btrim(residence_name), '') IS NULL
   AND NULLIF(btrim(profile_city), '') IS NOT NULL;

ALTER TABLE participants ENABLE TRIGGER onboarding_residence;
