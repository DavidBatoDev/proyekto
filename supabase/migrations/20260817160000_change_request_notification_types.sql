-- Migration: 20260817160000_change_request_notification_types.sql
-- Date: August 17, 2026
-- Description:
--   Notification types for the change-request workflow.
--
--   Change requests shipped with an audit trail but no notifications, which made
--   the workflow dead-end: someone raises a scope change, and the only way anyone
--   learns of it is by happening to open the Change Requests page. The decision is
--   the whole point of the object, so the people who can decide have to be told,
--   and the requester has to hear the outcome.
--
--   Recipients come ENTIRELY from the permissions catalog and the request's own
--   requested_by — this is the execution layer, so a project has members with
--   permissions, not a client and a consultant. `_submitted` goes to holders of
--   `change_requests.decide`; `_decided` goes to the requester, and additionally
--   to those holders on an approval because applying it to the roadmap is a
--   separate step that needs the same permission; `_applied` goes to the
--   requester. Fan-out lives in ChangeRequestsService.notify.
--
--   Priorities: submitted and decided are `high` because someone is blocked on
--   them; applied is `medium` — it is a confirmation, not a request for action.
--
--   Deliberately NOT email_eligible. The email registry
--   (notifications/email/notification-email-registry.ts) fails closed, so these
--   produce in-app + push only. Turning email on later means adding a renderer
--   there AND updating the parity spec's emailable set together.

INSERT INTO public.notification_types (name, category, priority)
VALUES
  ('change_request_submitted', 'specific', 'high'),
  ('change_request_decided', 'specific', 'high'),
  ('change_request_applied', 'specific', 'medium')
ON CONFLICT (name) DO NOTHING;
