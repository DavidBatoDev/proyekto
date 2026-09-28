-- Account deletion, part 1 of 3: the tombstone column, its guard, and the
-- bookkeeping tables.
--
-- Google Play requires an app that lets people create an account to offer
-- account deletion in the app. Proyekto had no delete-account path at all.
--
-- WHY THE PROFILE ROW SURVIVES A "DELETE"
--
-- public.profiles.id REFERENCES auth.users(id) ON DELETE CASCADE is the root of
-- 166 foreign keys in public (70 CASCADE / 14 RESTRICT / 82 SET NULL, recounted
-- on dev 2026-09-23), plus 10 internal auth.* ones. A real DELETE fails two ways
-- at once:
--
--   * The 14 RESTRICTs abort the transaction - payouts, contracts,
--     contract_positions, engagement_*, consultant_profiles, talent_profiles,
--     roadmap_template_usages/reports, qa_fixtures. Those are deliberate;
--     docs/14-engagement/data-model.md records that restrictive legal-party FKs
--     exist to preserve attribution.
--   * Many CASCADEs hang off SHARED containers - projects.owner_id,
--     roadmaps.owner_id, teams.owner_id, finance_books.owner_user_id,
--     chat_room_messages.sender_id, meetings.created_by, files.uploaded_by,
--     task_attachments.uploaded_by. Deleting one member would destroy a whole
--     team of people's work. Every last-owner guard we have is application-layer
--     and is bypassed by an FK cascade (see the note in seat-sync.service.ts).
--
-- So deletion scrubs the row in place instead. Three consequences, and the third
-- is the one that makes the whole design work:
--
--   1. No CASCADE ever fires, so no third-party data is destroyed.
--   2. No RESTRICT ever blocks, so this ships without altering a single FK.
--   3. The 82 SET NULL actor stamps never fire either. project_activity_log.
--      actor_id, notifications.actor_id, roadmap_change_history.actor_id,
--      invoices.issuer_user_id keep pointing here, and every existing PostgREST
--      embed resolves to display_name = 'Deleted user' with no code change.
--      Preserving attribution is not a compromise here; it is the mechanism.
--
-- The FK graph is inert. Deletion is an explicit, enumerated set of statements
-- (see 20260923090200_delete_account.sql).
--
-- NOTE: this establishes the first soft-delete convention on a principal table
-- in this schema. chat_room_messages.deleted_at (message unsend) is the only
-- other deleted_at in public; there is no is_deleted and no status = 'deleted'
-- anywhere. Everything that reads profiles should treat deleted_at IS NOT NULL
-- as "this person is gone, the row is only an attribution target".

BEGIN;

-- == 1. The tombstone marker ================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at
  ON public.profiles (deleted_at)
  WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN public.profiles.deleted_at IS
  'Tombstone marker. Non-null means the account was deleted in-app: every PII column is scrubbed, email is rotated to an unroutable .invalid address, the auth row is disabled and every membership row is gone. The row is retained only so content the person authored in shared spaces keeps an attribution target ("Deleted user"). First soft-delete column on a principal table in this schema.';

-- == 2. Guard: a tombstone may not be edited by the client ==================
-- authenticated holds UPDATE on public.profiles (20260922130000 deliberately
-- left its grants alone because the web edits profiles), and the policy
-- "Users can update own profile" is USING (auth.uid() = id) with a NULL
-- WITH CHECK - no column limit. Without this guard a deleted user holding a
-- still-valid access token (JWTs stay valid until expiry; see the Redis
-- deny-list in the backend) could PATCH /rest/v1/profiles?id=eq.<self> to
-- restore their display name or clear deleted_at and undo the deletion.
--
-- DELETE needs no guard: profiles has no DELETE policy and RLS is enabled, so
-- a client delete (which would fire the cascade above) is already denied.
--
-- Same shape as profiles_guest_columns_guard in 20260922130000: SECURITY
-- INVOKER, keyed on current_user, so the service-role and DEFINER paths pass.
CREATE OR REPLACE FUNCTION public.profiles_tombstone_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND (OLD.deleted_at IS NOT NULL
          OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    RAISE EXCEPTION 'Account deletion is managed by Proyekto'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.profiles_tombstone_guard() IS
  'Rejects anon/authenticated updates that touch a tombstoned profile or that set or clear deleted_at. Deletion runs through delete_account() as service_role.';

-- Unqualified on purpose: this must fire on EVERY column update of a
-- tombstoned row, not only on deleted_at.
DROP TRIGGER IF EXISTS trg_profiles_tombstone_guard ON public.profiles;
CREATE TRIGGER trg_profiles_tombstone_guard
BEFORE UPDATE
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.profiles_tombstone_guard();

REVOKE ALL ON FUNCTION public.profiles_tombstone_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profiles_tombstone_guard() TO service_role;

-- == 3. Audit row ===========================================================
-- Deliberately carries no PII of the deleted user: what they chose, what it
-- added up to, and whether the object-store sweep finished. storage_status is
-- also the work queue for a reconciling sweeper later.
CREATE TABLE IF NOT EXISTS public.account_deletions (
  user_id        uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  deleted_at     timestamptz NOT NULL DEFAULT now(),
  resolution     jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary        jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_status text  NOT NULL DEFAULT 'pending'
    CHECK (storage_status IN ('pending', 'done', 'partial', 'failed')),
  storage_error  text
);

COMMENT ON TABLE public.account_deletions IS
  'One row per completed in-app account deletion. Holds the resolution the user chose and the resulting counts, never their personal data. ON DELETE CASCADE so fixture teardown (auth.admin.deleteUser in the integration harness) still works.';

ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.account_deletions TO service_role;

-- == 4. Re-auth challenge for password-less accounts ========================
-- Google-only accounts have an empty auth.users.encrypted_password, so there is
-- no password to re-check before an irreversible action. They get a mailed code
-- instead.
--
-- This is NOT email_verification_codes, for three reasons: that table's CHECK
-- allows only purpose IN ('signup','login'); all four /api/auth/email-* routes
-- are @Public() and take the address from the request body, so anyone knowing
-- an email could drive the flow with no session; and confirmEmailVerification
-- looks codes up with no purpose filter, which would let a signup code confirm
-- an account deletion. This table is authenticated, keyed by user id, and
-- rate-limited by an attempts counter.
CREATE TABLE IF NOT EXISTS public.account_deletion_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  salt        text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_account_deletion_challenges_user_live
  ON public.account_deletion_challenges (user_id, created_at DESC)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE public.account_deletion_challenges IS
  'Short-lived re-authentication codes for account deletion on accounts with no password (Google sign-in). Stored as sha256 of salt, a pipe and the code - the same idiom as email-otp.service.ts.';

ALTER TABLE public.account_deletion_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_deletion_challenges TO service_role;

-- == 5. Stop the guest reaper from eating tombstones ========================
-- cleanup_old_guest_users() does a hard DELETE FROM profiles, which fires
-- exactly the 70-way cascade this whole design exists to avoid. Two reasons it
-- matters here:
--
--   * profiles_email_required_for_non_guests (is_guest = TRUE OR email IS NOT
--     NULL) makes is_guest = TRUE look like the easy way to clear a tombstone's
--     email. It is a trap - the guest header path in SupabaseAuthGuard treats
--     guest_session_id as a bearer secret, and entitlement_subject makes
--     guest-owned objects plan-limit exempt. delete_account() rotates the email
--     instead and never touches the guest columns. The predicate below is
--     belt-and-braces for that rule.
--   * Nothing schedules this today (pg_cron is not installed on either
--     project and the cron in 20260210000000 is commented out), but it is
--     callable via POST /guests/cleanup behind AdminGuard.
--
-- Body carried forward from the live definition (20260210000000_add_guest_users
-- .sql), with the predicate added and the missing search_path pinned.
CREATE OR REPLACE FUNCTION public.cleanup_old_guest_users()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete guest profiles older than 30 days. Cascade handles roadmaps and
  -- related data - which is why deleted accounts must never match here.
  DELETE FROM profiles
  WHERE is_guest = TRUE
    AND deleted_at IS NULL
    AND created_at < (now() - INTERVAL '30 days');

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_old_guest_users() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_guest_users() TO service_role;

COMMIT;
