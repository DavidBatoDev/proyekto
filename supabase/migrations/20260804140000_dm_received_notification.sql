-- Phase 2 — direct messages produce a notification.
--
-- Today a plain DM notifies nobody: ChatService.sendDmMessage publishes a
-- realtime event and calls fireMentionNotifications, which returns immediately
-- when the message carries no @mentions. No notification row means no bell
-- entry, no push, and (since the email outbox is fed by an AFTER INSERT ON
-- notifications trigger) no email either.
--
-- Email for this type is activated by a separate migration, so reverting the
-- activation is one file.

INSERT INTO public.notification_types (name, category, priority)
VALUES ('chat_dm_received', 'specific', 'medium')
ON CONFLICT (name) DO NOTHING;

-- Supports two things on the DM send path, which is now awaited rather than
-- fire-and-forget:
--
--   1. the dedup probe — "does this recipient already have a live unread
--      notification for this room?" — which filters on user_id, is_read and
--      content->>'room_id';
--   2. any future room-keyed sweep over unread notifications.
--
-- Without it the probe rides idx_notifications_user_read_created and then
-- residual-filters every unread row of that user, with a heap fetch each since
-- `content` is not in that index. That is fine at twenty unread rows and bad at
-- thousands — and thousands is realistic precisely because nothing marks chat
-- notifications read, so they accumulate monotonically.
--
-- Partial on is_read = false: only unread rows are ever probed, and marking one
-- read prunes its entry, so the index stays small.
CREATE INDEX IF NOT EXISTS idx_notifications_unread_by_room
  ON public.notifications (user_id, (content->>'room_id'), created_at DESC)
  WHERE is_read = false;

COMMENT ON INDEX public.idx_notifications_unread_by_room IS
  'Serves the DM send-path dedup probe (user_id + room_id over unread rows). Only chat notifications carry content.room_id, so non-chat rows occupy an entry with a NULL expression value and never match a probe.';
