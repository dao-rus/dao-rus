-- Independent, global participant-to-participant communication reputation.
-- Existing interaction_quality signals retain their meaning and indexes.
ALTER TABLE reputation_signals
  DROP CONSTRAINT reputation_signals_dimension_check,
  DROP CONSTRAINT reputation_signals_signal_type_check;
ALTER TABLE reputation_signals
  ADD CONSTRAINT reputation_signals_dimension_check
    CHECK (dimension IN ('interaction_quality', 'communication')),
  ADD CONSTRAINT reputation_signals_signal_type_check
    CHECK (
      (dimension = 'interaction_quality' AND signal_type IN ('positive', 'quality_flag'))
      OR (dimension = 'communication' AND signal_type IN ('positive', 'negative'))
    );
CREATE INDEX reputation_signals_communication_subject_idx
  ON reputation_signals(subject_participant_id)
  WHERE dimension = 'communication' AND revoked_at IS NULL;
