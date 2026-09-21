CREATE TABLE ui_text_overrides (
  key text PRIMARY KEY CHECK (key IN (
    'home.eyebrow',
    'home.title',
    'home.lead',
    'home.login_button',
    'home.profile_button'
  )),
  value text NOT NULL CHECK (length(btrim(value)) BETWEEN 1 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
