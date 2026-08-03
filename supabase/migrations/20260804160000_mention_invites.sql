-- Phase 3 — mention someone who has no account.
--
-- An admin types an email into a roadmap comment's @mention picker; the person
-- is invited, emailed once, and finds the mention waiting after signup.
--
-- Lands INERT. `roadmap_mention_invite` is seeded with email_eligible = false,
-- and the backend service reads that same flag before creating anything — so
-- until it is flipped, no invite row and no email is produced. Activation and
-- rollback are one UPDATE, no deploy, exactly like the mention/DM phases.
--
-- This migration also fixes a live bug in the two EXISTING profiles
-- reconcilers; see the block near the bottom.

-- ── where a pending mention lives ───────────────────────────────────────────
--
-- Not `project_invites`: that table's UNIQUE (project_id, invitee_email) allows
-- exactly one row per email per project, but a person may be named in five
-- comments before they sign up, and each is a separate thing to show them.
-- Its upsert also resets status/responded_at, so writing mentions through it
-- would corrupt real invite state.
CREATE TABLE IF NOT EXISTS public.pending_mention_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored already-lowercased and pinned by the CHECK, so the reconciler's
  -- lookup is a plain indexed equality. The neighbouring reconcilers compare
  -- lower(col) = lower(x), which no plain index can serve.
  invitee_email text NOT NULL
    CHECK (invitee_email = lower(invitee_email) AND length(invitee_email) <= 254),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  roadmap_id uuid NOT NULL REFERENCES public.roadmaps(id) ON DELETE CASCADE,
  source_type text NOT NULL
    CHECK (source_type IN ('task_comment', 'epic_comment', 'feature_comment')),
  -- No FK: the source is one of three different comment tables. Cleanup rides
  -- the project/roadmap cascades plus expires_at.
  source_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  invited_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Snapshots: the comment may be edited or deleted before they ever sign up.
  actor_name text,
  -- Held for the IN-APP notification after signup only. It is deliberately NOT
  -- sent in the pre-signup email — see the template; mailing 280 characters of
  -- a private thread to someone who has proven nothing is the sharpest edge on
  -- this feature, and a typo'd address makes it unrecallable.
  excerpt text,
  link_url text NOT NULL,
  project_invite_id uuid REFERENCES public.project_invites(id) ON DELETE SET NULL,
  -- Their only way to opt out. They have no account, so the per-user settings
  -- row that backs normal unsubscribe cannot exist yet.
  unsubscribe_token text NOT NULL UNIQUE
    DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reconciled', 'expired', 'revoked')),
  reconciled_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reconciled_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '90 days',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pending_mention_invites IS
  'A mention of someone with no account yet, held until they sign up. Rows say "this address was named in this private project", which is exactly the disclosure this feature has to contain — hence service-role-only access.';
COMMENT ON COLUMN public.pending_mention_invites.excerpt IS
  'Shown in-app after signup. Never included in the pre-signup email.';
COMMENT ON COLUMN public.pending_mention_invites.unsubscribe_token IS
  'Bearer capability for a recipient with no account. Its scope writes an email_suppressions row rather than a settings row. Never log it.';

-- The reconciler's only lookup. Partial, so it stays small forever.
CREATE INDEX IF NOT EXISTS idx_pending_mention_invites_email
  ON public.pending_mention_invites (invitee_email) WHERE status = 'pending';

-- Idempotency and the ON CONFLICT target: editing or resubmitting a comment
-- must not stack duplicate rows for the same person and comment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_mention_invites_dedupe
  ON public.pending_mention_invites (invitee_email, source_type, source_id);

-- Backs the per-actor daily cap. Deliberately counts only this automated path:
-- capping on project_invites.invited_by would also count deliberate Team-page
-- invites, so a lead who onboards fifteen people in the morning would lose
-- mention-invites for the rest of the day.
CREATE INDEX IF NOT EXISTS idx_pending_mention_invites_actor_day
  ON public.pending_mention_invites (invited_by, created_at DESC);

-- RLS ON with NO policies, deliberately — service-role only, matching
-- notification_email_outbox and email_suppressions. No client needs to read
-- this, and a policy broad enough to be useful would leak the disclosure above.
-- A future admin revocation UI goes through the backend with an explicit role
-- check, not through RLS.
ALTER TABLE public.pending_mention_invites ENABLE ROW LEVEL SECURITY;

-- Backs the per-ADDRESS send spacing in the email worker. Recipients without an
-- account have no user_id, so the existing (user_id, processed_at) index cannot
-- serve them.
CREATE INDEX IF NOT EXISTS idx_notification_email_outbox_email_sent
  ON public.notification_email_outbox (to_email, processed_at DESC)
  WHERE status = 'sent';

-- ── the notification type ───────────────────────────────────────────────────
--
-- email_eligible stays false: the pre-signup email is sent by the backend
-- directly, and this type's notification is created at signup. Making it
-- eligible would email the person ten minutes after they signed up, about the
-- mention they signed up because of.
INSERT INTO public.notification_types (name, category, priority)
VALUES ('roadmap_mention_invite', 'specific', 'medium')
ON CONFLICT (name) DO NOTHING;

-- ── reconciliation at signup ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_profile_mention_invites_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_type_id uuid;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_notification_type_id
  FROM public.notification_types
  WHERE name = 'roadmap_mention_invite'
  LIMIT 1;

  IF v_notification_type_id IS NOT NULL THEN
    -- NOTE: no freshness window here, unlike the two reconcilers below.
    -- Deliberate: a mention may be weeks old by the time the person signs up,
    -- which is the entire point of the feature. expires_at is the bound.
    INSERT INTO public.notifications
      (user_id, project_id, type_id, actor_id, content, link_url, created_at)
    SELECT
      NEW.id,
      pm.project_id,
      v_notification_type_id,
      pm.invited_by,
      jsonb_build_object(
        'pending_mention_id', pm.id,
        'message',
          coalesce(nullif(btrim(pm.actor_name), ''), 'Someone')
          || ' mentioned you in a comment on '
          || coalesce(p.title, 'a project')
          || '.',
        'actor_name', pm.actor_name,
        'excerpt', pm.excerpt,
        'source_type', pm.source_type,
        'source_id', pm.source_id,
        'project_title', p.title
      ),
      pm.link_url,
      -- Distinct per row. All three reconcilers otherwise write the transaction
      -- timestamp, so notifications created during one signup tie and the bell
      -- order is nondeterministic.
      clock_timestamp()
    FROM public.pending_mention_invites pm
    LEFT JOIN public.projects p ON p.id = pm.project_id
    WHERE pm.invitee_email = lower(NEW.email)
      AND pm.status = 'pending'
      AND pm.expires_at > now()
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.user_id = NEW.id
          AND n.type_id = v_notification_type_id
          AND n.content ->> 'pending_mention_id' = pm.id::text
      );
  END IF;

  UPDATE public.pending_mention_invites pm
  SET status = 'reconciled',
      reconciled_user_id = NEW.id,
      reconciled_at = now()
  WHERE pm.invitee_email = lower(NEW.email)
    AND pm.status = 'pending'
    AND pm.expires_at > now();

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- MANDATORY. handle_new_user() wraps the profile insert, the wallet and the
    -- email-confirm in a single PL/pgSQL block with its own WHEN OTHERS handler,
    -- and that block takes an implicit subtransaction. An exception escaping
    -- this trigger therefore rolls ALL of it back, leaving an auth.users row
    -- with no profile. Signup must survive anything that happens in here.
    RAISE WARNING 'handle_profile_mention_invites_reconciliation failed for profile %: % (SQLSTATE %)',
      NEW.id, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;

-- Name sorts before trg_profiles_reconcile_project_invites and
-- ..._team_invites. Same-event triggers fire in name order; nothing here
-- depends on that order, but stating it beats leaving it accidental.
DROP TRIGGER IF EXISTS trg_profiles_reconcile_mention_invites ON public.profiles;
CREATE TRIGGER trg_profiles_reconcile_mention_invites
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.handle_profile_mention_invites_reconciliation();

-- ── fixing the two EXISTING reconcilers ─────────────────────────────────────
--
-- Rebuilt from their newest bodies (project: 20260312100000 lines 93-168;
-- team: 20260507000060 lines 137-193) per the latest-function-body rule.
-- Exactly three changes to each, and nothing else:
--
--   1. The freshness window goes from 1 minute to 90 days. At one minute, an
--      invite reconciles its invitee_id but produces NO notification unless the
--      person signs up within sixty seconds of being invited — so the ordinary
--      case (invited today, signs up tomorrow) is silent. 90 days matches
--      pending_mention_invites.expires_at so all three paths agree. Unbounded
--      would ping a brand-new user about a two-year-old abandoned invite.
--
--   2. An EXCEPTION guard. Today either function throwing takes down signup
--      entirely, per the note in the new function above. This is the more
--      important half of this migration.
--
--   3. created_at = clock_timestamp() on the notification insert, so rows from
--      one signup no longer tie.

CREATE OR REPLACE FUNCTION public.handle_profile_project_invites_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_type_id uuid;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.project_invites pi
  SET
    invitee_id = NEW.id,
    updated_at = now()
  WHERE pi.invitee_id IS NULL
    AND pi.invitee_email IS NOT NULL
    AND lower(pi.invitee_email) = lower(NEW.email)
    AND pi.status = 'pending';

  SELECT id INTO v_notification_type_id
  FROM public.notification_types
  WHERE name = 'project_invite_received'
  LIMIT 1;

  IF v_notification_type_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, project_id, type_id, actor_id, content, link_url, created_at)
    SELECT
      NEW.id,
      pi.project_id,
      v_notification_type_id,
      pi.invited_by,
      jsonb_build_object(
        'invite_id', pi.id,
        'message',
          coalesce(nullif(btrim(inviter.display_name), ''), 'A team lead')
          || ' invited you to join '
          || coalesce(p.title, 'this project')
          || CASE
               WHEN nullif(btrim(pi.invited_position), '') IS NOT NULL
                 THEN ' as ' || btrim(pi.invited_position)
               ELSE ''
             END
          || '.'
          || CASE
               WHEN nullif(btrim(pi.message), '') IS NOT NULL
                 THEN ' Note: ' || btrim(pi.message)
               ELSE ''
             END,
        'invited_position', pi.invited_position,
        'project_title', p.title,
        'inviter_name', coalesce(nullif(btrim(inviter.display_name), ''), 'A team lead'),
        'note', nullif(btrim(pi.message), '')
      ),
      '/freelancer/invites',
      clock_timestamp()
    FROM public.project_invites pi
    LEFT JOIN public.projects p ON p.id = pi.project_id
    LEFT JOIN public.profiles inviter ON inviter.id = pi.invited_by
    WHERE pi.invitee_id = NEW.id
      AND pi.status = 'pending'
      AND pi.created_at >= now() - interval '90 days'
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.user_id = NEW.id
          AND n.project_id = pi.project_id
          AND n.type_id = v_notification_type_id
          AND n.content ->> 'invite_id' = pi.id::text
      );
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'handle_profile_project_invites_reconciliation failed for profile %: % (SQLSTATE %)',
      NEW.id, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_profile_team_invites_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notification_type_id uuid;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.team_invites ti
  SET
    invitee_id = NEW.id,
    updated_at = now()
  WHERE ti.invitee_id IS NULL
    AND ti.invitee_email IS NOT NULL
    AND lower(ti.invitee_email) = lower(NEW.email)
    AND ti.status = 'pending';

  SELECT id INTO v_notification_type_id
  FROM public.notification_types
  WHERE name = 'team_invite_received'
  LIMIT 1;

  IF v_notification_type_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, project_id, type_id, actor_id, content, link_url, created_at)
    SELECT
      NEW.id,
      NULL,
      v_notification_type_id,
      ti.invited_by,
      jsonb_build_object(
        'invite_id', ti.id,
        'team_id', ti.team_id,
        'invited_role', ti.role,
        'message', ti.message
      ),
      '/teams/me/invites',
      clock_timestamp()
    FROM public.team_invites ti
    WHERE ti.invitee_id = NEW.id
      AND ti.status = 'pending'
      AND ti.created_at >= now() - interval '90 days'
      AND NOT EXISTS (
        SELECT 1
        FROM public.notifications n
        WHERE n.user_id = NEW.id
          AND n.type_id = v_notification_type_id
          AND n.content ->> 'invite_id' = ti.id::text
      );
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'handle_profile_team_invites_reconciliation failed for profile %: % (SQLSTATE %)',
      NEW.id, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;
