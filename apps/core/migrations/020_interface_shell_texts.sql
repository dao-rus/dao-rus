ALTER TABLE ui_text_overrides
  DROP CONSTRAINT ui_text_overrides_key_check,
  ADD CONSTRAINT ui_text_overrides_key_check CHECK (key IN (
    'home.eyebrow',
    'home.title',
    'home.lead',
    'home.login_button',
    'home.profile_button',
    'participants.title',
    'exchange.title',
    'exchange.lead',
    'exchange.empty',
    'need.title',
    'need.lead',
    'relay.list_title',
    'relay.archive_title',
    'relay.dialog_title',
    'relay.list_empty',
    'relay.archive_empty',
    'relay.messages_empty',
    'profile.eyebrow'
  ));
