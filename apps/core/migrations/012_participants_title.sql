ALTER TABLE ui_text_overrides
  DROP CONSTRAINT ui_text_overrides_key_check,
  ADD CONSTRAINT ui_text_overrides_key_check CHECK (key IN (
    'home.eyebrow',
    'home.title',
    'home.lead',
    'home.login_button',
    'home.profile_button',
    'participants.title'
  ));
