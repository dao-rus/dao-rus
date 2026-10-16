ALTER TABLE participants
  ADD COLUMN profile_city text,
  ADD COLUMN profile_occupation text,
  ADD COLUMN profile_education text,
  ADD COLUMN profile_family_status text;

ALTER TABLE reception_applications
  ALTER COLUMN city DROP NOT NULL,
  ALTER COLUMN occupation DROP NOT NULL,
  ADD COLUMN education text,
  ADD COLUMN family_status text,
  ADD COLUMN source_message_update_id bigint,
  ADD COLUMN draft_prompt_sent_at timestamptz,
  ADD COLUMN draft_prompt_error_code text,
  DROP CONSTRAINT reception_applications_city_check,
  DROP CONSTRAINT reception_applications_occupation_check,
  DROP CONSTRAINT reception_applications_status_check,
  ADD CONSTRAINT reception_applications_city_check CHECK (city IS NULL OR char_length(btrim(city)) BETWEEN 1 AND 200),
  ADD CONSTRAINT reception_applications_occupation_check CHECK (occupation IS NULL OR char_length(btrim(occupation)) BETWEEN 1 AND 1000),
  ADD CONSTRAINT reception_applications_education_check CHECK (education IS NULL OR char_length(btrim(education)) BETWEEN 1 AND 500),
  ADD CONSTRAINT reception_applications_family_status_check CHECK (family_status IS NULL OR char_length(btrim(family_status)) BETWEEN 1 AND 120),
  ADD CONSTRAINT reception_applications_status_check CHECK (status IN ('draft', 'submitted', 'deferred', 'closed')),
  ADD CONSTRAINT reception_applications_source_update_unique UNIQUE (source_message_update_id);

ALTER TABLE reception_application_deliveries
  DROP CONSTRAINT reception_application_deliveries_kind_check,
  ADD CONSTRAINT reception_application_deliveries_kind_check CHECK (kind IN ('publication', 'invitation'));
