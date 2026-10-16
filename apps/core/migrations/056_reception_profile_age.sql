ALTER TABLE participants
  ADD COLUMN profile_age smallint CHECK (profile_age BETWEEN 1 AND 120);
