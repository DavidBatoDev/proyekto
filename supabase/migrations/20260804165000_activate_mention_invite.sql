-- Notification email — ACTIVATION for mention-by-email.
--
-- This one flag gates both halves: RoadmapMentionInviteService reads it before
-- creating an invite or queueing mail, and ProjectsService.getMyPermissions folds
-- it into mentions.invite_by_email so the editor's "Invite <address>" affordance
-- appears with it. One statement moves the server and the UI together.
--
-- It is also the rollback. Setting it back to false stops NEW rows immediately,
-- with no deploy — but anything already queued still sends on the next dispatch
-- run, so a real rollback is two statements (see
-- docs/11-domains/notifications-and-push.md → Watching it).
--
-- NOTE the overload, and see 20260804170000, which lands with this: for the
-- mention and DM types `email_eligible` tells enqueue_notification_email() to
-- queue mail when a notification is created. For THIS type it is a feature
-- switch, and the trigger has to skip it — otherwise flipping this on also
-- emails people about the signup-time notification they only received because
-- they had already acted on the pre-signup invite.

UPDATE public.notification_types
SET email_eligible = true
WHERE name = 'roadmap_mention_invite';
