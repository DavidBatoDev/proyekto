-- Notification email — ACTIVATION for direct messages.
--
-- Kept separate from the migration that creates the type, for the same reason
-- 20260804120000 was separate: that one is reviewed on its mechanics, this one
-- starts mailing real people. It is also the rollback — set email_eligible back
-- to false and DM email stops immediately, with no deploy and no code change.
--
-- 1800s rather than the 600s mentions use. DM threads are bursty and usually
-- answered within minutes, so a ten-minute fuse mails people mid-conversation.
-- Half an hour lets the delay do the suppressing, which is the whole design.
-- Per-user volume stays capped by MIN_INTERVAL_MINUTES (15) across all types.

UPDATE public.notification_types
SET email_eligible = true,
    email_delay_seconds = 1800
WHERE name = 'chat_dm_received';
