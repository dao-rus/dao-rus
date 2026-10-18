CREATE TABLE slovotvor_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word_id uuid NOT NULL REFERENCES slovotvor_words(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES slovotvor_users(participant_id) ON DELETE CASCADE,
  choice text NOT NULL CHECK (choice IN ('better', 'worse')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (word_id, participant_id)
);

CREATE INDEX slovotvor_votes_word_choice_idx
  ON slovotvor_votes (word_id, choice);
