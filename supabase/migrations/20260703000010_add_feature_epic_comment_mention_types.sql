-- Add notification types for @mentions in feature and epic comments.
-- task_comment_mention already exists; these two mirror it exactly.

INSERT INTO public.notification_types (name, category, priority)
VALUES
  ('feature_comment_mention', 'specific', 'medium'),
  ('epic_comment_mention',    'specific', 'medium')
ON CONFLICT (name) DO NOTHING;
