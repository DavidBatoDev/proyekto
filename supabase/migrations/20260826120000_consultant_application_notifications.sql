-- Consultant application rebuild, phase 3: notifications.
--
-- 1. `consultant_application_submitted` — in-app only, fanned out to active
--    admins when an application arrives. Until now the review queue had no
--    signal at all: admins had to poll /admin/applications to learn an
--    application existed.
-- 2. Email activation for the approve/reject verdicts. Their renderers land
--    in the same change (notification-email-registry.ts); the registry fails
--    closed, so this flag without the renderer would produce silence, and the
--    parity spec asserts the two agree. Setting these back to false is the
--    rollback and stops verdict email immediately, no deploy.

INSERT INTO public.notification_types (name, category, priority)
VALUES ('consultant_application_submitted', 'global', 'medium')
ON CONFLICT (name) DO NOTHING;

UPDATE public.notification_types
SET email_eligible = true,
    email_delay_seconds = 600
WHERE name IN (
  'consultant_application_approved',
  'consultant_application_rejected'
);
