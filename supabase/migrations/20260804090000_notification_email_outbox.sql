-- Notification email, phase 1a — lands DARK.
--
-- Every notification_types row gets email_eligible = false below, so the
-- trigger enqueues nothing and the worker has nothing to claim. Activation is a
-- later UPDATE of that flag: no deploy, instantly revertible.
--
-- Shape is copied from ai_knowledge_outbox (20260713090100): partial index on
-- the unprocessed set, a claim RPC using FOR UPDATE SKIP LOCKED with attempts
-- stamped at claim time, dead-lettering in place, RLS on with no policies.

-- ── delivery policy, per notification type ──────────────────────────────────
ALTER TABLE public.notification_types
  ADD COLUMN IF NOT EXISTS email_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_delay_seconds int NOT NULL DEFAULT 600,
  ADD COLUMN IF NOT EXISTS email_default_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.notification_types.email_eligible IS
  'Master switch per type. The enqueue trigger reads only this — flipping it on/off is the activation and rollback lever, and needs no deploy.';
COMMENT ON COLUMN public.notification_types.email_delay_seconds IS
  'How long to wait before emailing, so someone who reads the in-app notification never gets mail about it.';
COMMENT ON COLUMN public.notification_types.email_default_enabled IS
  'Whether users are opted in by default; a notification_preferences row overrides it.';

-- ── per-user settings + the unsubscribe capability ──────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_email_settings (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  all_email_enabled boolean NOT NULL DEFAULT true,
  -- Hex, not base64: '+' and '/' are not URL-safe and this rides in a query
  -- string. Same reasoning as contract_signature_links.token (20260730093000).
  -- pgcrypto is schema-qualified because it is installed in `extensions`, and an
  -- unqualified call resolves only when the caller's search_path happens to
  -- include it (see 20260705152000, which fixed exactly this).
  unsubscribe_token text NOT NULL UNIQUE
    DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.notification_email_settings.unsubscribe_token IS
  'Bearer capability embedded in every notification email. Grants exactly one power: turning email off for this user. Never log it.';

ALTER TABLE public.notification_email_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_email_settings_select_own
  ON public.notification_email_settings FOR SELECT
  USING (auth.uid() = user_id);

-- No INSERT/UPDATE policy on purpose: writes go through the backend so the
-- token can never be rotated or read into a client payload by accident.

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type_id uuid NOT NULL REFERENCES public.notification_types(id) ON DELETE CASCADE,
  email_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, type_id)
);

COMMENT ON TABLE public.notification_preferences IS
  'Sparse overrides. An absent row means "use notification_types.email_default_enabled", so opting in costs no rows and no backfill.';

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_preferences_select_own
  ON public.notification_preferences FOR SELECT
  USING (auth.uid() = user_id);

-- ── addresses we must stop mailing ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  email text PRIMARY KEY,
  reason text NOT NULL CHECK (reason IN ('hard_bounce', 'complaint', 'manual')),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_suppressions IS
  'Checked before every send. Nothing populates it while Gmail is the transport (it exposes no bounce or complaint feedback) — it exists so the ESP migration has somewhere to write on day one.';

ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY; -- no policies: service-role only

-- ── the outbox ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_email_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Null for mail that has no in-app counterpart, i.e. someone who does not yet
  -- have an account (phase 3, mention-by-email).
  notification_id uuid REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  type_name text NOT NULL,
  -- Resolved at send time from the profile when null; set explicitly for
  -- recipients who have no profile yet.
  to_email text,
  send_after timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  skip_reason text,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Every row must be deliverable to someone.
  CONSTRAINT notification_email_outbox_recipient_present
    CHECK (user_id IS NOT NULL OR to_email IS NOT NULL)
);

-- Idempotency: one email per notification, enforced by the database rather than
-- by the trigger remembering not to double-insert.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_email_outbox_notification
  ON public.notification_email_outbox (notification_id)
  WHERE notification_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_email_outbox_due
  ON public.notification_email_outbox (send_after)
  WHERE status = 'pending';

-- Backs the per-user minimum-interval check, which reads the last send per user.
CREATE INDEX IF NOT EXISTS idx_notification_email_outbox_user_sent
  ON public.notification_email_outbox (user_id, processed_at DESC)
  WHERE status = 'sent';

ALTER TABLE public.notification_email_outbox ENABLE ROW LEVEL SECURITY; -- no policies: service-role only

COMMENT ON TABLE public.notification_email_outbox IS
  'Deferred notification email. A row is a candidate, not a promise: the worker re-checks read state, preferences and suppression immediately before sending, and may resolve it to skipped.';

-- Atomic batch claim. attempts is stamped at claim time so a worker crash
-- mid-batch still burns an attempt; rows at >= p_max_attempts are dead-lettered
-- (stay pending, excluded from claims, visible via SQL).
--
-- Known window: a process death between the provider accepting a message and
-- the status write yields at most one duplicate, bounded by attempts. Closing it
-- would need a two-phase commit with the mail provider, which does not exist.
CREATE OR REPLACE FUNCTION public.claim_notification_email_outbox(
  p_batch int DEFAULT 25,
  p_max_attempts int DEFAULT 5
) RETURNS SETOF public.notification_email_outbox
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.notification_email_outbox o
  SET attempts = o.attempts + 1
  WHERE o.id IN (
    SELECT id FROM public.notification_email_outbox
    WHERE status = 'pending'
      AND send_after <= now()
      AND attempts < p_max_attempts
    ORDER BY send_after
    LIMIT LEAST(GREATEST(p_batch, 1), 100)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING o.*;
$$;

-- Enqueue on notification creation.
--
-- A trigger rather than a call inside NotificationsService.createNotification:
-- it adds no latency to a path that already awaits an FCM send, it cannot miss a
-- notification, and it also catches rows inserted by SQL — the project-invite
-- reconciliation trigger writes notifications directly, with no backend
-- involvement. Same reasoning as enqueue_brief_knowledge().
--
-- Deliberately dumb: it reads the two policy columns and copies content. Every
-- other decision (preferences, read state, suppression, rate caps, rendering)
-- belongs to the worker, in TypeScript, where it can be tested.
CREATE OR REPLACE FUNCTION public.enqueue_notification_email()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_type public.notification_types%ROWTYPE;
BEGIN
  SELECT * INTO v_type
  FROM public.notification_types
  WHERE id = NEW.type_id;

  IF NOT FOUND OR NOT v_type.email_eligible THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notification_email_outbox
    (notification_id, user_id, type_name, send_after, payload)
  VALUES (
    NEW.id,
    NEW.user_id,
    v_type.name,
    now() + make_interval(secs => v_type.email_delay_seconds),
    jsonb_build_object(
      'content', COALESCE(NEW.content, '{}'::jsonb),
      'link_url', NEW.link_url,
      'project_id', NEW.project_id,
      'actor_id', NEW.actor_id
    )
  )
  ON CONFLICT (notification_id) WHERE notification_id IS NOT NULL DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Never let an outbox problem destroy the notification itself. The in-app
    -- row is the source of truth; email is an extra.
    RAISE WARNING 'enqueue_notification_email failed for notification %: % (SQLSTATE %)',
      NEW.id, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_enqueue_email ON public.notifications;
CREATE TRIGGER trg_notifications_enqueue_email
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_notification_email();
