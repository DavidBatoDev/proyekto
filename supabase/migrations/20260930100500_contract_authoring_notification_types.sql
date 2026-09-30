-- Notification types for two-way contract authoring and recorded agreements.
-- Additive seed only.

INSERT INTO public.notification_types (name, category, priority)
VALUES
  ('contract_sent', 'specific', 'high'),
  ('contract_changed', 'specific', 'high'),
  ('contract_withdrawn', 'specific', 'medium'),
  ('contract_attestation_requested', 'specific', 'high')
ON CONFLICT (name) DO NOTHING;
