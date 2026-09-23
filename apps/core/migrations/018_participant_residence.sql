ALTER TABLE participants
  ADD COLUMN residence_name text,
  ADD COLUMN residence_type text,
  ADD COLUMN residence_country text,
  ADD CONSTRAINT participants_residence_complete CHECK (
    (residence_name IS NULL AND residence_type IS NULL AND residence_country IS NULL)
    OR (residence_name IS NOT NULL AND residence_type IS NOT NULL AND residence_country IS NOT NULL)
  );

CREATE INDEX participants_residence_lookup_idx
  ON participants (lower(residence_country), lower(residence_type), lower(residence_name))
  WHERE residence_name IS NOT NULL;
