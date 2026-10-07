-- Migration: 20261003100000_time_timesheets_backfill.sql  (time management rebuild, M2)
--
-- docs/13-proposals/time-management/migrations-and-rollout.md#m2-timesheets-backfill
-- docs/13-proposals/time-management/data-model.md (triggers 30 and 40)
--
-- Groups every non-personal legacy entry into a timesheet, classifies each
-- imported sheet from its entries' per-entry review state, and from then on
-- keeps entries on their sheet (trg_30) and locks submitted, approved,
-- frozen, settled, billed and legacy-marked entries (trg_40).
--
-- The running (old) backend keeps working: status and reviewed_* stay
-- writable on every row until M5, so a per-entry review (or a stop/start in
-- the current week) still succeeds. Edits of entries in submitted or approved
-- weeks fail with TIME_ENTRY_LOCKED / TIME_PERIOD_LOCKED, as documented.
--
-- Steps:
--   1. Precheck (invariants, never counts).
--   2. Helpers, time_legacy_backfill(boolean), then time_legacy_backfill(false).
--   3. Constraints: time_entries_context_check, biconditional work_item_check.
--   4. trg_time_entries_30_timesheet, trg_time_entries_40_lock.
--   5. Payout RPCs, build #1 (latest bodies: create_payout_and_mark_paid from
--      20260907090000:48-147, void_payout_and_revert from 20260701000020:179-214).
--   6. Mark the old per-entry approval notifications read.
--   7. Privileges: service role only.
--
-- Self-review checklist (P01 acceptance b):
--   [x] Every new function is SECURITY DEFINER with SET search_path = public, pg_temp,
--       and EXECUTE is revoked from PUBLIC, anon, authenticated (step 7); the two
--       payout RPCs keep their service-role-only ACL (re-asserted in step 7).
--   [x] No write to task_time_logs.status except the payout RPCs' own UPDATEs
--       (create: 'paid', void: 'approved'); time_legacy_backfill never writes it.
--   [x] time_legacy_backfill's body starts with #variable_conflict use_column.
--   [x] Every new raise goes through time_raise(code, detail): TIME_ENTRY_LOCKED,
--       TIME_PERIOD_LOCKED, TIMESHEET_SCOPE_REQUIRED, PAYOUT_SELF_NOT_ALLOWED,
--       FIXED_RATE_NOT_PAYABLE_BY_ENTRY. (The payout RPCs' existing plain-text
--       raises are carried over unchanged.)
--   [x] No function body names task_time_log_segments, time_log_comments or the
--       engagement approval tables; trg_30 and time_legacy_approver_scope name no
--       entry table at all (M3 does not rebuild them).
--   [x] The M2 verification block is pasted as a trailing comment.
--
-- ROLLBACK (manual; migrations-and-rollout > Rollback per step, 4-5 M2).
-- Lossless: old-backend reviews made after M2 live on status.
--   BEGIN;
--   SELECT set_config('app.time_maintenance', 'on', true);
--   DROP TRIGGER trg_time_entries_30_timesheet ON public.task_time_logs;
--   DROP TRIGGER trg_time_entries_40_lock ON public.task_time_logs;
--   ALTER TABLE public.task_time_logs DROP CONSTRAINT time_entries_context_check,
--     DROP CONSTRAINT time_entries_work_item_check,
--     ADD CONSTRAINT time_entries_work_item_check
--       CHECK (work_item IN ('task', 'meeting', 'review', 'admin', 'other'));
--   -- restore create_payout_and_mark_paid from 20260907090000:48-147 and
--   -- void_payout_and_revert from 20260701000020:179-214 (CREATE OR REPLACE, then
--   -- REVOKE ... FROM PUBLIC, anon, authenticated; GRANT ... TO service_role)
--   UPDATE public.task_time_logs SET timesheet_id = NULL, payable_seconds = NULL,
--     amount_snapshot = NULL, legacy_status = NULL;
--   DELETE FROM public.timesheet_events;
--   DELETE FROM public.timesheets;
--   DROP FUNCTION public.time_legacy_backfill(boolean);
--   DROP FUNCTION public.time_legacy_freeze(uuid);
--   DROP FUNCTION public.time_legacy_approver_scope(public.timesheets, jsonb);
--   DROP FUNCTION public.time_legacy_sheet_facts(uuid);
--   DROP FUNCTION public.tg_time_entries_timesheet();
--   DROP FUNCTION public.tg_time_entries_lock();
--   DROP FUNCTION public.time_raise(text, jsonb);
--   NOTIFY pgrst, 'reload schema';
--   COMMIT;
--   Notifications marked read stay read (cosmetic; the old queue reads entry
--   status). Workspace time_policies rows materialised by the grouping may stay
--   (time_ensure_workspace_policy recreates the same defaults).

BEGIN;

SET LOCAL lock_timeout = '5s';
SELECT set_config('app.time_maintenance', 'on', true);

-- Readers and writers wait a few seconds (bounded by lock_timeout); step 3's
-- validated constraints need this lock anyway, so take it up front.
LOCK TABLE public.task_time_logs IN ACCESS EXCLUSIVE MODE;

-- ── 1. Precheck (invariants, never counts) ─────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.time_ensure_timesheet(uuid,text,uuid,uuid,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'M2 precheck: M1 (time_entries_expand) has not been applied';
  END IF;

  IF to_regprocedure('public.time_legacy_backfill(boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'M2 precheck: time_legacy_backfill already exists (M2 applied?)';
  END IF;

  IF EXISTS (SELECT 1 FROM public.timesheets) THEN
    RAISE EXCEPTION 'M2 precheck: public.timesheets is not empty';
  END IF;

  IF EXISTS (SELECT 1 FROM public.task_time_logs WHERE context_kind IS NULL) THEN
    RAISE EXCEPTION 'M2 precheck: an entry has no context_kind';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.task_time_logs
    WHERE context_kind <> 'personal' AND (context_ref IS NULL OR member_user_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'M2 precheck: a non-personal entry has no context_ref or no member_user_id';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.task_time_logs
    WHERE status IN ('approved', 'paid', 'rejected') AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'M2 precheck: a decided entry is still running';
  END IF;

  IF EXISTS (SELECT 1 FROM public.task_time_logs WHERE (task_id IS NULL) = (work_item = 'task')) THEN
    RAISE EXCEPTION 'M2 precheck: work_item does not follow task_id on some entry';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.teams t
    WHERE t.id = 'dc583f8a-7869-47d2-a16d-1d66fa42f3ba'
      AND (NOT EXISTS (SELECT 1 FROM public.time_policies p WHERE p.scope = 'team' AND p.team_id = t.id)
           OR (t.workspace_id IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM public.time_policies p
                 WHERE p.scope = 'workspace' AND p.workspace_id = t.workspace_id)))
  ) THEN
    RAISE EXCEPTION 'M2 precheck: the Prodigitality team or workspace time policy row is missing';
  END IF;
END $$;

-- ── 2. Helpers and the legacy backfill ──────────────────────────────────────

-- Every new M2/M3 sentinel: error.message is the bare code, error.details is
-- JSON text (TS maps both through mapTimeDbError).
CREATE FUNCTION public.time_raise(p_code text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING MESSAGE = p_code, DETAIL = coalesce(p_detail, '{}'::jsonb)::text;
END;
$$;

-- Facts of one sheet's entries.
CREATE FUNCTION public.time_legacy_sheet_facts(p_timesheet_id uuid)
RETURNS TABLE (n int, pending int, running int, new_rejected int, total int,
               min_created timestamptz, max_created timestamptz, max_reviewed_at timestamptz,
               max_updated timestamptz, last_reviewer uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::int,
         count(*) FILTER (WHERE e.status = 'pending')::int,
         count(*) FILTER (WHERE e.ended_at IS NULL)::int,
         count(*) FILTER (WHERE e.status = 'rejected' AND e.legacy_status IS NULL)::int,
         coalesce(sum(coalesce(e.duration_seconds, 0)), 0)::int,
         min(e.created_at), max(e.created_at), max(e.reviewed_at), max(e.updated_at),
         (array_agg(e.reviewed_by ORDER BY e.reviewed_at DESC NULLS LAST, e.updated_at DESC)
            FILTER (WHERE e.reviewed_by IS NOT NULL))[1]
  FROM public.task_time_logs e
  WHERE e.timesheet_id = p_timesheet_id;
$$;

-- The approver scope an imported sheet is frozen with.
CREATE FUNCTION public.time_legacy_approver_scope(p_sheet public.timesheets, p_pol jsonb)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_sheet.scope_kind
    WHEN 'team' THEN CASE WHEN p_sheet.team_id IS NOT NULL AND p_pol->>'approver_scope' = 'team'
                          THEN 'team' ELSE 'workspace' END
    WHEN 'workspace' THEN 'workspace'
    WHEN 'engagement' THEN CASE WHEN (SELECT g.kind FROM public.engagements g WHERE g.id = p_sheet.engagement_id)
                                     = 'talent_services' THEN 'hirer' ELSE 'auto' END
  END;
$$;

-- D13: an imported approved sheet is frozen from the stored snapshot; a
-- rejected entry counts 0. Caller holds app.time_maintenance.
CREATE FUNCTION public.time_legacy_freeze(p_timesheet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.task_time_logs e
     SET payable_seconds = v.ps,
         amount_snapshot = CASE WHEN coalesce(e.rate_type_snapshot, 'hourly') = 'hourly'
                                THEN round(v.ps / 3600.0 * coalesce(e.rate_snapshot, 0), 2) END
    FROM (SELECT x.id, CASE WHEN x.legacy_status = 'rejected' THEN 0
                            ELSE coalesce(x.duration_seconds, 0) END AS ps
            FROM public.task_time_logs x
           WHERE x.timesheet_id = p_timesheet_id) v
   WHERE e.id = v.id;
END;
$$;

-- Groups legacy entries into timesheets and classifies the imported sheets
-- (p_reconcile = false, M2), or re-reconciles imported sheets whose entries the
-- old backend changed after the import (p_reconcile = true, M4 and after a
-- rollback). Runs under app.time_maintenance, which it sets itself (PostgREST
-- cannot) and restores before returning. Never writes an entry's status.
CREATE FUNCTION public.time_legacy_backfill(p_reconcile boolean)
RETURNS TABLE (timesheet_id uuid, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_prev_maint text := current_setting('app.time_maintenance', true);
  r record;
  sc record;
  s public.timesheets%ROWTYPE;
  a record;
  pol jsonb;
  appr text;
  res text;
BEGIN
  PERFORM set_config('app.time_maintenance', 'on', true);

  -- A. Group (both modes): every sheetless non-personal entry lands on the
  -- sheet of its member x scope x period (created under maintenance with
  -- origin 'legacy_migration', submission_kind 'legacy').
  FOR r IN
    SELECT e.id, e.member_user_id, e.context_kind, e.context_ref, e.project_id, e.started_at
    FROM public.task_time_logs e
    WHERE e.context_kind <> 'personal' AND e.timesheet_id IS NULL
    ORDER BY e.member_user_id, e.started_at, e.id
  LOOP
    SELECT * INTO sc FROM public.time_sheet_scope_for(r.context_kind, r.context_ref, r.project_id);
    IF sc.scope_kind IS NULL THEN
      PERFORM public.time_raise('TIMESHEET_SCOPE_REQUIRED', jsonb_build_object('entry_id', r.id));
    END IF;
    UPDATE public.task_time_logs e
       SET timesheet_id = public.time_ensure_timesheet(r.member_user_id, sc.scope_kind, sc.scope_ref,
                                                       sc.policy_workspace_id, r.started_at)
     WHERE e.id = r.id;
  END LOOP;

  -- B. Markers by fact on every grouped entry (D18). In reconcile mode a newly
  -- rejected entry returns its sheet instead of being marked.
  IF NOT p_reconcile THEN
    UPDATE public.task_time_logs e SET legacy_status = 'rejected'
     WHERE e.status = 'rejected' AND e.legacy_status IS NULL AND e.timesheet_id IS NOT NULL;
  END IF;
  UPDATE public.task_time_logs e SET legacy_status = 'paid_outside'
   WHERE e.status = 'paid' AND e.payout_id IS NULL AND e.legacy_status IS NULL
     AND e.timesheet_id IS NOT NULL;

  IF NOT p_reconcile THEN
    -- C. Classify each imported sheet once ("today" in the sheet's timezone).
    FOR s IN
      SELECT t.* FROM public.timesheets t
      WHERE t.origin = 'legacy_migration'
        AND NOT EXISTS (SELECT 1 FROM public.timesheet_events v
                        WHERE v.timesheet_id = t.id AND v.event = 'legacy_import')
      ORDER BY t.id
      FOR UPDATE
    LOOP
      SELECT * INTO a FROM public.time_legacy_sheet_facts(s.id);
      pol := public.time_resolve_policy(s.scope_kind, s.scope_ref, s.policy_workspace_id,
                                        s.period_start::timestamp AT TIME ZONE s.timezone)
             || '{"legacy": true}'::jsonb;
      appr := public.time_legacy_approver_scope(s, pol);

      IF s.period_end >= (now() AT TIME ZONE s.timezone)::date OR a.running > 0 THEN
        res := 'open';
        UPDATE public.timesheets t
           SET policy_snapshot = pol, revision = t.revision + 1
         WHERE t.id = s.id;
      ELSIF a.pending > 0 THEN
        res := 'submitted';
        UPDATE public.timesheets t
           SET status = 'submitted', approver_scope = appr, policy_snapshot = pol,
               submission_kind = 'legacy', submitted_at = a.max_created, submitted_by = s.member_user_id,
               total_seconds = a.total, revision = t.revision + 1
         WHERE t.id = s.id;
      ELSE
        res := 'approved';
        PERFORM public.time_legacy_freeze(s.id);
        UPDATE public.timesheets t
           SET status = 'approved', approver_scope = appr, policy_snapshot = pol,
               submission_kind = 'legacy', submitted_at = a.min_created, submitted_by = s.member_user_id,
               decided_at = coalesce(a.max_reviewed_at, a.max_updated), decided_by = a.last_reviewer,
               decision_kind = 'legacy', total_seconds = a.total, revision = t.revision + 1,
               payable_seconds = (SELECT coalesce(sum(e.payable_seconds), 0)::int
                                  FROM public.task_time_logs e
                                  WHERE e.timesheet_id = s.id
                                    AND e.legacy_status IS DISTINCT FROM 'rejected')
         WHERE t.id = s.id;
      END IF;

      INSERT INTO public.timesheet_events (timesheet_id, event, from_status, to_status, note,
                                           total_seconds, payable_seconds, revision)
      SELECT t.id, 'legacy_import', NULL, res, 'Imported from per-entry review',
             t.total_seconds, t.payable_seconds, t.revision
      FROM public.timesheets t WHERE t.id = s.id;

      timesheet_id := s.id;
      action := 'imported_' || res;
      RETURN NEXT;
    END LOOP;
  ELSE
    -- Reconcile: imported submitted / approved sheets with an entry the old
    -- backend changed after the import.
    FOR s IN
      SELECT t.* FROM public.timesheets t
      WHERE t.origin = 'legacy_migration'
        AND t.status IN ('submitted', 'approved')
        AND EXISTS (SELECT 1
                    FROM public.timesheet_events v
                    JOIN public.task_time_logs e ON e.timesheet_id = v.timesheet_id
                    WHERE v.timesheet_id = t.id AND v.event = 'legacy_import'
                      AND e.updated_at > v.created_at)
      ORDER BY t.id
      FOR UPDATE
    LOOP
      SELECT * INTO a FROM public.time_legacy_sheet_facts(s.id);

      IF s.status = 'approved' THEN
        -- An old-backend re-review after the import: report, change nothing.
        IF a.pending > 0 OR a.new_rejected > 0 THEN
          timesheet_id := s.id;
          action := 'flagged_approved_changed';
          RETURN NEXT;
        END IF;
      ELSIF s.submission_kind = 'legacy' AND a.new_rejected > 0 THEN
        UPDATE public.timesheets t
           SET status = 'returned', decision_note = 'Returned during the move to timesheets',
               decided_at = coalesce(a.max_reviewed_at, now()), decided_by = a.last_reviewer,
               decision_kind = 'legacy', total_seconds = a.total, revision = t.revision + 1
         WHERE t.id = s.id;
        INSERT INTO public.timesheet_events (timesheet_id, event, from_status, to_status, note,
                                             total_seconds, payable_seconds, revision)
        SELECT t.id, 'returned', 'submitted', 'returned', 'Returned during the move to timesheets',
               t.total_seconds, t.payable_seconds, t.revision
        FROM public.timesheets t WHERE t.id = s.id;
        timesheet_id := s.id;
        action := 'reconciled_returned';
        RETURN NEXT;
      ELSIF s.submission_kind = 'legacy' AND a.pending = 0 AND a.running = 0 THEN
        PERFORM public.time_legacy_freeze(s.id);
        UPDATE public.timesheets t
           SET status = 'approved',
               decided_at = coalesce(a.max_reviewed_at, a.max_updated), decided_by = a.last_reviewer,
               decision_kind = 'legacy', total_seconds = a.total, revision = t.revision + 1,
               payable_seconds = (SELECT coalesce(sum(e.payable_seconds), 0)::int
                                  FROM public.task_time_logs e
                                  WHERE e.timesheet_id = s.id
                                    AND e.legacy_status IS DISTINCT FROM 'rejected')
         WHERE t.id = s.id;
        INSERT INTO public.timesheet_events (timesheet_id, event, from_status, to_status, note,
                                             total_seconds, payable_seconds, revision)
        SELECT t.id, 'approved', 'submitted', 'approved', NULL,
               t.total_seconds, t.payable_seconds, t.revision
        FROM public.timesheets t WHERE t.id = s.id;
        timesheet_id := s.id;
        action := 'reconciled_approved';
        RETURN NEXT;
      END IF;
    END LOOP;
  END IF;

  PERFORM set_config('app.time_maintenance', coalesce(v_prev_maint, ''), true);
  RETURN;
END;
$$;

-- Prod expectation on 2026-10-05: 64 sheets (30 approved, 34 submitted, 0 open);
-- recompute on the apply date.
SELECT count(*) AS imported_sheets FROM public.time_legacy_backfill(false);

-- ── 3. Constraints (one ALTER, one validating scan) ────────────────────────
ALTER TABLE public.task_time_logs
  DROP CONSTRAINT time_entries_work_item_check,
  ADD CONSTRAINT time_entries_work_item_check
    CHECK (work_item IN ('task', 'meeting', 'review', 'admin', 'other')
           AND ((work_item = 'task') = (task_id IS NOT NULL))),
  ADD CONSTRAINT time_entries_context_check CHECK (CASE context_kind
    WHEN 'personal'   THEN num_nonnulls(team_id, workspace_id, engagement_assignment_id, context_ref, timesheet_id) = 0
    WHEN 'team'       THEN num_nonnulls(engagement_assignment_id, workspace_id) = 0 AND context_ref IS NOT NULL
                           AND timesheet_id IS NOT NULL AND (team_id IS NULL OR team_id = context_ref)
    WHEN 'workspace'  THEN num_nonnulls(engagement_assignment_id, team_id) = 0 AND context_ref IS NOT NULL
                           AND timesheet_id IS NOT NULL AND (workspace_id IS NULL OR workspace_id = context_ref)
    WHEN 'assignment' THEN num_nonnulls(team_id, workspace_id) = 0 AND engagement_assignment_id = context_ref
                           AND timesheet_id IS NOT NULL END);

-- ── 4. Triggers ─────────────────────────────────────────────────────────────

-- trg_time_entries_30_timesheet: an entry's sheet follows its member, context
-- and start; callers never choose the sheet. A sheet's bounds never move.
CREATE FUNCTION public.tg_time_entries_timesheet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_maint boolean := coalesce(current_setting('app.time_maintenance', true), '') = 'on';
  cur public.timesheets%ROWTYPE;
  sc record;
  v_sheet uuid;
  v_status text;
BEGIN
  IF NEW.context_kind = 'personal' THEN
    NEW.timesheet_id := NULL;
    RETURN NEW;
  END IF;

  -- Maintenance callers (the backfill) may place an entry on a sheet.
  IF v_maint AND NEW.timesheet_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.timesheet_id IS DISTINCT FROM OLD.timesheet_id) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.timesheet_id := OLD.timesheet_id;
    -- L17: a member FK cascading to NULL keeps the entry where it is.
    IF NEW.member_user_id IS NULL THEN
      RETURN NEW;
    END IF;
    IF OLD.timesheet_id IS NOT NULL
       AND (NEW.member_user_id, NEW.context_kind, NEW.context_ref)
           IS NOT DISTINCT FROM (OLD.member_user_id, OLD.context_kind, OLD.context_ref) THEN
      SELECT * INTO cur FROM public.timesheets t WHERE t.id = OLD.timesheet_id;
      -- Still inside the current sheet's local period: keep it (trg_40 judges locks).
      IF FOUND AND (NEW.started_at AT TIME ZONE cur.timezone)::date
                   BETWEEN cur.period_start AND cur.period_end THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  IF NEW.member_user_id IS NULL THEN
    PERFORM public.time_raise('TIMESHEET_SCOPE_REQUIRED', '{"reason":"member"}'::jsonb);
  END IF;
  SELECT * INTO sc FROM public.time_sheet_scope_for(NEW.context_kind, NEW.context_ref, NEW.project_id);
  IF sc.scope_kind IS NULL THEN
    PERFORM public.time_raise('TIMESHEET_SCOPE_REQUIRED', '{"reason":"scope"}'::jsonb);
  END IF;

  v_sheet := public.time_ensure_timesheet(NEW.member_user_id, sc.scope_kind, sc.scope_ref,
                                          sc.policy_workspace_id, NEW.started_at);
  -- FOR SHARE: an insert racing an approve waits, then fails, instead of
  -- landing unfrozen inside an approved sheet.
  SELECT t.status INTO v_status FROM public.timesheets t WHERE t.id = v_sheet FOR SHARE;
  IF v_status NOT IN ('open', 'returned') AND NOT v_maint THEN
    PERFORM public.time_raise('TIME_PERIOD_LOCKED',
                              jsonb_build_object('timesheet_id', v_sheet, 'status', v_status));
  END IF;

  NEW.timesheet_id := v_sheet;
  RETURN NEW;
END;
$$;

-- D19: also fires on team_id / workspace_id / engagement_assignment_id (the old
-- backend's project move writes the FK and trg_10 re-derives the context), and
-- on timesheet_id (so a caller's choice is overridden).
CREATE TRIGGER trg_time_entries_30_timesheet
  BEFORE INSERT OR UPDATE OF started_at, member_user_id, context_kind, context_ref, team_id, workspace_id,
                             engagement_assignment_id, timesheet_id
  ON public.task_time_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_time_entries_timesheet();

-- trg_time_entries_40_lock: locked entries (paid, billed, legacy-marked,
-- frozen, or on a submitted / approved sheet) refuse deletes and every change
-- outside the allowed keys. The settlement and freeze columns are protected on
-- every row, locked or not (D20).
CREATE FUNCTION public.tg_time_entries_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_maint boolean := coalesce(current_setting('app.time_maintenance', true), '') = 'on';
  v_settlement boolean := coalesce(current_setting('app.time_settlement', true), '') = 'on';
  v_freeze boolean := coalesce(current_setting('app.time_freeze', true), '') = 'on';
  v_sheet text;
  v_reason text;
  -- status and reviewed_* stay writable until M5 (L4); M3 renames the review
  -- keys, M5 drops the last four.
  v_allowed text[] := ARRAY['updated_at', 'member_display_name_snapshot',
                            'status', 'reviewed_by', 'reviewed_at', 'review_note'];
  v_payout_cascade boolean := false;
BEGIN
  IF v_maint THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.timesheet_id IS NOT NULL THEN
    SELECT t.status INTO v_sheet FROM public.timesheets t WHERE t.id = OLD.timesheet_id FOR SHARE;
  END IF;

  v_reason := CASE
    WHEN OLD.payout_id IS NOT NULL OR OLD.legacy_status = 'paid_outside' THEN 'paid'
    WHEN EXISTS (SELECT 1 FROM public.invoice_time_entries r WHERE r.entry_id = OLD.id) THEN 'billed'
    WHEN OLD.legacy_status IS NOT NULL THEN 'legacy'
    WHEN OLD.payable_seconds IS NOT NULL THEN 'frozen'
    WHEN v_sheet IN ('submitted', 'approved') THEN 'sheet_' || v_sheet
  END;

  IF TG_OP = 'DELETE' THEN
    IF v_reason IS NOT NULL THEN
      PERFORM public.time_raise('TIME_ENTRY_LOCKED',
                                jsonb_build_object('entry_id', OLD.id, 'reason', v_reason));
    END IF;
    RETURN OLD;
  END IF;

  -- FK SET NULL cascades (the RI action runs after the parent row is gone): a
  -- value -> NULL change passes only when the referenced row no longer exists,
  -- so a deliberate write cannot pass as a cascade.
  IF OLD.project_id IS NOT NULL AND NEW.project_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = OLD.project_id) THEN
    v_allowed := v_allowed || ARRAY['project_id'];
  END IF;
  IF OLD.task_id IS NOT NULL AND NEW.task_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.roadmap_tasks k WHERE k.id = OLD.task_id) THEN
    v_allowed := v_allowed || ARRAY['task_id', 'work_item'];
  END IF;
  IF OLD.member_user_id IS NOT NULL AND NEW.member_user_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.member_user_id) THEN
    v_allowed := v_allowed || ARRAY['member_user_id'];
  END IF;
  IF OLD.team_id IS NOT NULL AND NEW.team_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.teams tm WHERE tm.id = OLD.team_id) THEN
    v_allowed := v_allowed || ARRAY['team_id'];
  END IF;
  IF OLD.workspace_id IS NOT NULL AND NEW.workspace_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = OLD.workspace_id) THEN
    v_allowed := v_allowed || ARRAY['workspace_id'];
  END IF;
  IF OLD.reviewed_by IS NOT NULL AND NEW.reviewed_by IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.reviewed_by) THEN
    v_allowed := v_allowed || ARRAY['reviewed_by'];
  END IF;
  IF OLD.payout_id IS NOT NULL AND NEW.payout_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.payouts y WHERE y.id = OLD.payout_id) THEN
    v_payout_cascade := true;
  END IF;

  -- Protected on every row (hardening, D20).
  IF NEW.payout_id IS DISTINCT FROM OLD.payout_id AND NOT (v_settlement OR v_payout_cascade) THEN
    PERFORM public.time_raise('TIME_ENTRY_LOCKED',
                              jsonb_build_object('entry_id', OLD.id, 'reason', 'settlement_only'));
  END IF;
  IF ((NEW.payable_seconds, NEW.amount_snapshot) IS DISTINCT FROM (OLD.payable_seconds, OLD.amount_snapshot)
      AND NOT v_freeze)
     OR (NEW.legacy_status IS DISTINCT FROM OLD.legacy_status
         AND NOT (v_freeze AND OLD.legacy_status = 'rejected' AND NEW.legacy_status IS NULL)) THEN
    PERFORM public.time_raise('TIME_ENTRY_LOCKED',
                              jsonb_build_object('entry_id', OLD.id, 'reason', 'freeze_only'));
  END IF;

  IF v_reason IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_settlement OR v_payout_cascade THEN
    v_allowed := v_allowed || ARRAY['payout_id'];
  END IF;
  IF v_freeze THEN
    v_allowed := v_allowed || ARRAY['payable_seconds', 'amount_snapshot', 'rate_snapshot',
                                    'rate_type_snapshot', 'currency_snapshot', 'legacy_status'];
  END IF;

  IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed) THEN
    PERFORM public.time_raise('TIME_ENTRY_LOCKED',
                              jsonb_build_object('entry_id', OLD.id, 'reason', v_reason));
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_time_entries_40_lock
  BEFORE UPDATE OR DELETE ON public.task_time_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_time_entries_lock();

-- ── 5. Payout RPCs, build #1 ───────────────────────────────────────────────
-- create_payout_and_mark_paid: body from 20260907090000:48-147 (the latest
-- definition; prod md5(prosrc) e9d7abdf). Changes: PAYOUT_SELF_NOT_ALLOWED;
-- app.time_settlement around the entry UPDATE; payable = approved per sheet
-- (payable_seconds set) or, until M5, per entry (status 'approved'), team
-- context only and never legacy-marked; fixed-rate entries refused; total over
-- payable_seconds when frozen. The status = 'paid' / reviewed_* UPDATE stays
-- (trg_40 admits it).
CREATE OR REPLACE FUNCTION public.create_payout_and_mark_paid(
  p_team_id uuid,
  p_member_user_id uuid,
  p_created_by uuid,
  p_currency text,
  p_log_ids uuid[],
  p_payout_method_id uuid DEFAULT NULL,
  p_reference_number text DEFAULT NULL,
  p_proof_path text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_paid_at timestamptz DEFAULT now(),
  p_source text DEFAULT 'batch'
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected int := array_length(p_log_ids, 1);
  v_matched int;
  v_total numeric(14,2);
  v_method public.payout_methods%ROWTYPE;
  v_payout public.payouts;
  v_prev_settlement text := current_setting('app.time_settlement', true);
BEGIN
  IF v_expected IS NULL OR v_expected = 0 THEN
    RAISE EXCEPTION 'No time logs supplied for payout';
  END IF;

  IF p_created_by IS NOT DISTINCT FROM p_member_user_id THEN
    PERFORM public.time_raise('PAYOUT_SELF_NOT_ALLOWED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.teams
     WHERE id = p_team_id
       AND payouts_enabled
  ) THEN
    RAISE EXCEPTION 'Payouts are disabled for this team';
  END IF;

  -- Lock the target logs (FOR UPDATE cannot be combined with aggregates, so
  -- this is a separate row-locking pass before the count/sum below).
  PERFORM 1
    FROM public.task_time_logs
   WHERE id = ANY (p_log_ids)
     AND team_id = p_team_id
     AND member_user_id = p_member_user_id
     AND context_kind = 'team' AND legacy_status IS NULL AND (payable_seconds IS NOT NULL OR status = 'approved')
     AND payout_id IS NULL
     AND currency_snapshot = p_currency
   FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.task_time_logs
     WHERE id = ANY (p_log_ids)
       AND rate_type_snapshot = 'fixed'
  ) THEN
    PERFORM public.time_raise('FIXED_RATE_NOT_PAYABLE_BY_ENTRY');
  END IF;

  -- Validate + compute the authoritative total over the now-locked rows.
  SELECT count(*),
         COALESCE(round(sum(COALESCE(payable_seconds, duration_seconds, 0) / 3600.0 * rate_snapshot), 2), 0)
    INTO v_matched, v_total
    FROM public.task_time_logs
   WHERE id = ANY (p_log_ids)
     AND team_id = p_team_id
     AND member_user_id = p_member_user_id
     AND context_kind = 'team' AND legacy_status IS NULL AND (payable_seconds IS NOT NULL OR status = 'approved')
     AND payout_id IS NULL
     AND currency_snapshot = p_currency;

  IF v_matched <> v_expected THEN
    RAISE EXCEPTION 'One or more logs are not payable (must be approved, unpaid, same member/team, and % currency)', p_currency;
  END IF;

  -- Snapshot the chosen method (verifying it belongs to the member being paid).
  IF p_payout_method_id IS NOT NULL THEN
    SELECT * INTO v_method
      FROM public.payout_methods
     WHERE id = p_payout_method_id
       AND user_id = p_member_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payout method does not belong to the member being paid';
    END IF;
  END IF;

  INSERT INTO public.payouts (
    team_id, member_user_id, created_by,
    payout_method_id, method_type, method_label,
    method_account_name, method_account_identifier, method_bank_name,
    currency, total_amount, reference_number, proof_path, note, paid_at, source
  ) VALUES (
    p_team_id, p_member_user_id, p_created_by,
    p_payout_method_id, v_method.method_type, v_method.label,
    v_method.account_name, v_method.account_identifier, v_method.bank_name,
    p_currency, v_total, p_reference_number, p_proof_path, p_note,
    COALESCE(p_paid_at, now()), p_source
  )
  RETURNING * INTO v_payout;

  PERFORM set_config('app.time_settlement', 'on', true);
  UPDATE public.task_time_logs
     SET status = 'paid',
         payout_id = v_payout.id,
         reviewed_by = p_created_by,
         reviewed_at = now(),
         updated_at = now()
   WHERE id = ANY (p_log_ids);
  PERFORM set_config('app.time_settlement', coalesce(v_prev_settlement, ''), true);

  RETURN v_payout;
END $$;

-- void_payout_and_revert: body from 20260701000020:179-214 (the only
-- definition; prod md5(prosrc) 28e27fbb). Only change: app.time_settlement
-- around the entry UPDATE.
CREATE OR REPLACE FUNCTION public.void_payout_and_revert(
  p_payout_id uuid,
  p_actor uuid
)
RETURNS public.payouts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payout public.payouts;
  v_prev_settlement text := current_setting('app.time_settlement', true);
BEGIN
  SELECT * INTO v_payout FROM public.payouts WHERE id = p_payout_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;
  IF v_payout.status = 'void' THEN
    RAISE EXCEPTION 'Payout is already void';
  END IF;

  PERFORM set_config('app.time_settlement', 'on', true);
  UPDATE public.task_time_logs
     SET status = 'approved',
         payout_id = NULL,
         reviewed_by = p_actor,
         reviewed_at = now(),
         updated_at = now()
   WHERE payout_id = p_payout_id
     AND status = 'paid';
  PERFORM set_config('app.time_settlement', coalesce(v_prev_settlement, ''), true);

  UPDATE public.payouts
     SET status = 'void', updated_at = now()
   WHERE id = p_payout_id
  RETURNING * INTO v_payout;

  RETURN v_payout;
END $$;

-- ── 6. Notifications (L32) ─────────────────────────────────────────────────
-- The per-entry approval queue is gone; its pending notices would point at
-- nothing actionable.
UPDATE public.notifications
   SET is_read = true, read_at = now()
 WHERE is_read = false
   AND type_id = (SELECT id FROM public.notification_types WHERE name = 'time_log_approval_requested');

-- ── 7. Function privileges: service role only ─────────────────────────────
REVOKE ALL ON FUNCTION
  public.time_raise(text, jsonb),
  public.time_legacy_sheet_facts(uuid),
  public.time_legacy_approver_scope(public.timesheets, jsonb),
  public.time_legacy_freeze(uuid),
  public.time_legacy_backfill(boolean)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.time_raise(text, jsonb),
  public.time_legacy_sheet_facts(uuid),
  public.time_legacy_approver_scope(public.timesheets, jsonb),
  public.time_legacy_freeze(uuid),
  public.time_legacy_backfill(boolean)
TO service_role;

REVOKE ALL ON FUNCTION
  public.tg_time_entries_timesheet(),
  public.tg_time_entries_lock()
FROM PUBLIC, anon, authenticated;

-- CREATE OR REPLACE keeps the payout RPCs' ACLs (20260701000030); re-asserted
-- so this file alone leaves them service-role only.
REVOKE ALL ON FUNCTION
  public.create_payout_and_mark_paid(uuid, uuid, uuid, text, uuid[], uuid, text, text, text, timestamptz, text),
  public.void_payout_and_revert(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.create_payout_and_mark_paid(uuid, uuid, uuid, text, uuid[], uuid, text, text, text, timestamptz, text),
  public.void_payout_and_revert(uuid, uuid)
TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Verification (migrations-and-rollout > Verification SQL > M2) ─────────
-- Run on each database after the apply, dev first.
--
-- SELECT status, origin, submission_kind, count(*) FROM timesheets GROUP BY 1,2,3;
--   -- prod 2026-10-02: approved/legacy_migration/legacy 30, submitted/…/legacy 32, open/…/legacy 2 (recompute on apply date)
-- SELECT count(*) FROM task_time_logs WHERE context_kind <> 'personal' AND timesheet_id IS NULL;   -- 0
-- SELECT legacy_status, count(*) FROM task_time_logs WHERE legacy_status IS NOT NULL GROUP BY 1;  -- prod: paid_outside 4, rejected 1
-- SELECT count(*) FROM task_time_logs e JOIN timesheets t ON t.id = e.timesheet_id
-- CROSS JOIN LATERAL time_sheet_scope_for(e.context_kind, e.context_ref, e.project_id) s
-- WHERE (e.started_at AT TIME ZONE t.timezone)::date NOT BETWEEN t.period_start AND t.period_end
--    OR e.member_user_id IS DISTINCT FROM t.member_user_id
--    OR (s.scope_kind, s.scope_ref) IS DISTINCT FROM (t.scope_kind, t.scope_ref);                -- 0
-- SELECT count(*) FROM task_time_logs e JOIN timesheets t ON t.id = e.timesheet_id
-- WHERE t.status = 'approved' AND e.payable_seconds IS NULL;                                        -- 0
-- -- L11 hours parity: new approved hours + approved-in-open-sheet hours = old approved+paid hours
-- SELECT round(sum(payable_seconds) FILTER (WHERE payable_seconds IS NOT NULL AND legacy_status IS DISTINCT FROM 'rejected') / 3600.0, 2) AS new_h,
--        round(sum(duration_seconds) FILTER (WHERE status IN ('approved','paid') AND payable_seconds IS NULL) / 3600.0, 2) AS open_h,
--        round(sum(duration_seconds) FILTER (WHERE status IN ('approved','paid')) / 3600.0, 2) AS old_h
-- FROM task_time_logs;                                                    -- new_h + coalesce(open_h,0) = old_h; prod 2026-10-02: 677.18 / NULL / 677.18
-- SELECT status, count(*) FROM task_time_logs GROUP BY 1;            -- equals the pre-M2 snapshot (184/225/4/1 on 2026-10-02 + new)
-- SELECT count(*) FROM timesheets t
-- WHERE (SELECT count(*) FROM timesheet_events v WHERE v.timesheet_id = t.id AND v.event = 'legacy_import') <> 1;  -- 0
-- SELECT conname, convalidated FROM pg_constraint
-- WHERE conname IN ('time_entries_context_check','time_entries_work_item_check');                  -- both true
-- SELECT count(*) FROM notifications n JOIN notification_types y ON y.id = n.type_id
-- WHERE y.name = 'time_log_approval_requested' AND NOT n.is_read;                                   -- 0
-- -- Dev smoke (BEGIN … ROLLBACK):
-- --   old-shape UPDATE status='approved' on a pending entry in a submitted legacy sheet -> succeeds
-- --   UPDATE duration_seconds on the same entry -> TIME_ENTRY_LOCKED
-- --   INSERT into a past submitted week -> TIME_PERIOD_LOCKED
-- --   create_payout_and_mark_paid on a fixture with one status='approved', payable NULL entry -> succeeds, writes status='paid'
