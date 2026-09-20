CREATE TABLE verification_roots (
  subject_id uuid PRIMARY KEY REFERENCES participants(id) ON DELETE RESTRICT,
  added_by_participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE verification_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verifier_subject_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  subject_id uuid NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (verifier_subject_id <> subject_id),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX verification_attestations_active_pair_idx
  ON verification_attestations(verifier_subject_id, subject_id)
  WHERE revoked_at IS NULL;

CREATE INDEX verification_attestations_active_subject_idx
  ON verification_attestations(subject_id, verifier_subject_id)
  WHERE revoked_at IS NULL;

CREATE INDEX verification_attestations_active_verifier_idx
  ON verification_attestations(verifier_subject_id, subject_id)
  WHERE revoked_at IS NULL;
