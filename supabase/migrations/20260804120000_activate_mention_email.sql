-- Notification email, phase 1b — ACTIVATION.
--
-- Separate from the phase-1a migration on purpose: that one lands the machinery
-- dark and is reviewed on its mechanics, this one starts sending mail to real
-- people and is reviewed on that basis. It is also the rollback: setting these
-- back to false stops all notification email immediately, with no deploy.
--
-- Only the four mention types. `chat_dm_received` does not exist yet (phase 2),
-- and no other type has a template — the worker fails closed on an eligible type
-- it cannot render, so a stray flag here would produce silence rather than a
-- blank email, but there is no reason to set one.
--
-- What a recipient gets: nothing at all if they read the notification in-app
-- within the delay window; otherwise one email, at most one per 15 minutes, with
-- a working one-click unsubscribe.

UPDATE public.notification_types
SET email_eligible = true,
    email_delay_seconds = 600
WHERE name IN (
  'task_comment_mention',
  'feature_comment_mention',
  'epic_comment_mention',
  'chat_mention'
);
