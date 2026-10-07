-- Migration: 20261003110000_rename_time_entries.sql  (time management rebuild, M3)
--
-- docs/13-proposals/time-management/migrations-and-rollout.md#m3-rename
-- docs/13-proposals/time-management/data-model.md (Renames; Group A and Group B)
--
-- Renames the entry tables to their final names, keeps the old names alive as
-- column-for-column compatibility views (security invoker, revoked from anon and
-- authenticated) until M5, drops the never-used engagement approval tables,
-- makes the policy audit survive a policy DELETE (D23), and rebuilds every
-- function body that names the entry tables, plus the timesheet engine.
--
-- The running (old) backend keeps working through the views: they are plain
-- projections, so they stay auto-updatable, the base-table triggers fire for
-- writes through them, and PostgREST still resolves the old FK-name embed hints
-- (constraint names only change in M5).
--
-- Sections (assembled by scratchpad/pr1/sql/assemble_m3.mjs, in this order):
--   00 head       precheck, renames, views, drops, time_policy_events (D23)
--   10 carryover  M2 bodies and the M1 guards on the new names
--   20 engine     time_timesheet_transition and its helpers
--   30 group A    account deletion, QA fixture, assignment-end, test cleanup
--   99 tail       privileges, NOTIFY, COMMIT, verification block
--
-- Self-review checklist (P02A acceptance):
--   [x] Every new or rebuilt function is SECURITY DEFINER with
--       SET search_path = public, pg_temp; EXECUTE is revoked from PUBLIC, anon,
--       authenticated and granted to service_role only (trigger functions:
--       REVOKE only) in the tail.
--   [x] No function body names the old entry tables or the engagement approval
--       tables (comments inside bodies included); the precheck DO block uses its
--       own dollar tag and is not a function.
--   [x] Carry-over bodies are the M2 bodies with only the rename map applied
--       (check_carryover.mjs prints nothing).
--   [x] Group A bodies are rebuilt from the newest defining migration, verified by
--       md5(prosrc) on prod and dev (account_deletion_preflight by its
--       comment-stripped, whitespace-collapsed md5).
--   [x] Every new raise goes through time_raise(code, detail).
--
-- ROLLBACK (manual; migrations-and-rollout > Rollback per step, 4-5 M3, plus the
-- D23 reversal). Lossless except the audit rows of deleted policies
-- (policy_id NULL), which the restored NOT NULL cannot hold.
--   BEGIN;
--   SELECT set_config('app.time_maintenance', 'on', true);
--   DROP VIEW public.task_time_logs, public.task_time_log_segments, public.time_log_comments;
--   ALTER TRIGGER trg_time_entry_comments_updated_at ON public.time_entry_comments
--     RENAME TO trg_time_log_comments_updated_at;
--   ALTER TABLE public.time_entry_comments RENAME COLUMN entry_id TO log_id;
--   ALTER TABLE public.time_entry_comments RENAME TO time_log_comments;
--   ALTER TABLE public.time_entry_segments RENAME COLUMN entry_id TO log_id;
--   ALTER TABLE public.time_entry_segments RENAME TO task_time_log_segments;
--   ALTER TABLE public.time_entries RENAME COLUMN legacy_review_note TO review_note;
--   ALTER TABLE public.time_entries RENAME COLUMN legacy_reviewed_at TO reviewed_at;
--   ALTER TABLE public.time_entries RENAME COLUMN legacy_reviewed_by TO reviewed_by;
--   ALTER TABLE public.time_entries RENAME TO task_time_logs;
--   -- Group B on the old names (CREATE OR REPLACE): tg_timesheets_guard and
--   --   tg_invoice_time_entries_guard from M1 (20261003090100:1067-1185, :1193-1230);
--   --   tg_time_entries_lock, time_legacy_sheet_facts, time_legacy_freeze,
--   --   time_legacy_backfill and the payout RPCs (build #1) from M2 (20261003100000).
--   -- Group A from their source lines (CREATE OR REPLACE), in this order:
--   --   account_deletion_close_running_logs_for_workspace (20260923090200:165-178, recreated),
--   --   account_deletion_purge_team (20260923090200:70-99),
--   --   account_deletion_purge_workspace (20260923090200:128-160),
--   --   account_deletion_preflight (20260923090100:79-282),
--   --   delete_account (20260923090200:211-607),
--   --   reset_qa_fixture (20260813120000:47-146),
--   --   tg_engagement_assignment_running_timer_guard (20260814021000:489-508);
--   --   then REVOKE/GRANT as in those files.
--   DROP FUNCTION public.time_test_cleanup(uuid);
--   DROP FUNCTION public.account_deletion_close_running_entries_for_workspace(uuid);
--   DROP FUNCTION public.account_deletion_team_has_open_time(uuid);
--   DROP FUNCTION public.account_deletion_workspace_has_open_time(uuid);
--   -- Engine (20_engine), after the Group A restores (they no longer call it):
--   DROP FUNCTION public.time_timesheet_transition(uuid[], uuid, text, integer[], text, boolean, jsonb);
--   DROP FUNCTION public.time_sheet_routing_preview(uuid, text);
--   DROP FUNCTION public.time_route_sheet(public.timesheets, text);
--   DROP FUNCTION public.time_clear_freeze(uuid);
--   DROP FUNCTION public.time_apply_freeze(uuid, jsonb);
--   DROP FUNCTION public.time_stop_running_entries(uuid[], timestamptz, text);
--   DROP FUNCTION public.time_approval_queue_ids(uuid, text, date);
--   DROP FUNCTION public.time_timesheet_deciders(uuid);
--   DROP FUNCTION public.time_scope_deciders(text, uuid, uuid, uuid, uuid);
--   DROP FUNCTION public.time_sheet_has_cost_money(uuid);
--   -- Engagement approval tables: recreate from 20260814021000:94-161, their guard
--   --   functions (:322-382, :384-439), triggers (:528-540), RLS (:555-556) and the
--   --   guard REVOKEs (:565-568).
--   -- The 3 policies: recreate from 20260810150000:45 and 20260528000010:26, :49.
--   -- D23:
--   DROP TRIGGER trg_time_policies_delete_event ON public.time_policies;
--   DROP FUNCTION public.time_policy_delete(uuid, uuid);
--   DROP FUNCTION public.tg_time_policies_delete_event();
--   --   restore tg_time_policies_events from M1 (20261003090100:1277-1305), then:
--   DELETE FROM public.time_policy_events WHERE policy_id IS NULL;
--   DROP INDEX public.time_policy_events_team_idx, public.time_policy_events_workspace_idx;
--   ALTER TABLE public.time_policy_events
--     DROP COLUMN scope, DROP COLUMN team_id, DROP COLUMN workspace_id,
--     DROP CONSTRAINT time_policy_events_policy_id_fkey,
--     ADD CONSTRAINT time_policy_events_policy_id_fkey FOREIGN KEY (policy_id)
--       REFERENCES public.time_policies(id) ON DELETE CASCADE,
--     ALTER COLUMN policy_id SET NOT NULL;
--   NOTIFY pgrst, 'reload schema';
--   COMMIT;

BEGIN;

SET LOCAL lock_timeout = '5s';
SELECT set_config('app.time_maintenance', 'on', true);

-- ── 1. Precheck (invariants, never counts) ─────────────────────────────────
DO $precheck$
BEGIN
  IF EXISTS (SELECT 1 FROM public.engagement_time_approvals)
     OR EXISTS (SELECT 1 FROM public.engagement_time_approval_items) THEN
    RAISE EXCEPTION 'M3 precheck: engagement time approval tables are not empty';
  END IF;

  IF to_regprocedure('public.time_legacy_backfill(boolean)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_time_entries_30_timesheet')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'time_entries_context_check') THEN
    RAISE EXCEPTION 'M3 precheck: M2 has not been applied';
  END IF;

  IF EXISTS (SELECT 1 FROM public.task_time_logs WHERE context_kind <> 'personal' AND timesheet_id IS NULL) THEN
    RAISE EXCEPTION 'M3 precheck: a non-personal entry has no timesheet';
  END IF;

  IF to_regclass('public.time_entries') IS NOT NULL THEN
    RAISE EXCEPTION 'M3 precheck: time_entries exists';
  END IF;
END $precheck$;

-- Readers and writers wait a few seconds (bounded by lock_timeout).
LOCK TABLE public.task_time_logs, public.task_time_log_segments, public.time_log_comments
  IN ACCESS EXCLUSIVE MODE;

-- ── 2. Policies (the backend is service role; no policy remains on time tables)
DROP POLICY "Users can read allowed time log segments" ON public.task_time_log_segments;
DROP POLICY "Users can read allowed time log comments" ON public.time_log_comments;
DROP POLICY "Users can add allowed time log comments" ON public.time_log_comments;

-- ── 3. Renames (constraint and index names wait for M5) ────────────────────
ALTER TABLE public.task_time_logs RENAME TO time_entries;
ALTER TABLE public.time_entries RENAME COLUMN reviewed_by TO legacy_reviewed_by;
ALTER TABLE public.time_entries RENAME COLUMN reviewed_at TO legacy_reviewed_at;
ALTER TABLE public.time_entries RENAME COLUMN review_note TO legacy_review_note;
ALTER TABLE public.task_time_log_segments RENAME TO time_entry_segments;
ALTER TABLE public.time_entry_segments RENAME COLUMN log_id TO entry_id;
ALTER TABLE public.time_log_comments RENAME TO time_entry_comments;
ALTER TABLE public.time_entry_comments RENAME COLUMN log_id TO entry_id;
ALTER TRIGGER trg_time_log_comments_updated_at ON public.time_entry_comments
  RENAME TO trg_time_entry_comments_updated_at;

-- ── 4. Compatibility views (M3 -> M5) ──────────────────────────────────────
-- Column for column, in the old tables' ordinal order (prod and dev), so they
-- stay auto-updatable and old selects, inserts and embeds keep working. Plain
-- column references, so PostgREST infers the base FKs under their (unchanged)
-- constraint names; reviewed_by keeps task_time_logs_reviewed_by_fkey.
CREATE VIEW public.task_time_logs WITH (security_invoker = true) AS
  SELECT id, project_id, task_id, member_user_id, started_at, ended_at, duration_seconds, status,
         legacy_reviewed_by AS reviewed_by, legacy_reviewed_at AS reviewed_at, legacy_review_note AS review_note,
         source, created_at, updated_at, rate_snapshot, currency_snapshot, team_id, work_type_snapshot, payout_id,
         rate_type_snapshot, break_minutes, paused_at, break_seconds, member_display_name_snapshot,
         engagement_assignment_id, flagged_reason
  FROM public.time_entries;
CREATE VIEW public.task_time_log_segments WITH (security_invoker = true) AS
  SELECT id, entry_id AS log_id, kind, started_at, ended_at, created_at FROM public.time_entry_segments;
CREATE VIEW public.time_log_comments WITH (security_invoker = true) AS
  SELECT id, entry_id AS log_id, author_user_id, body, created_at, updated_at FROM public.time_entry_comments;
-- The default ACL on public grants new views to anon and authenticated.
REVOKE ALL ON public.task_time_logs, public.task_time_log_segments, public.time_log_comments
  FROM anon, authenticated;
-- The old backend reads and writes through them as service_role (the default
-- ACL already grants it; re-asserted so this file alone is enough).
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.task_time_logs, public.task_time_log_segments, public.time_log_comments
  TO service_role;

-- ── 5. Engagement approval tables (0 rows; superseded by timesheets) ───────
-- Their triggers go with them. tg_engagement_touch_updated_at stays (shared).
DROP TABLE public.engagement_time_approval_items;
DROP TABLE public.engagement_time_approvals;
DROP FUNCTION public.tg_engagement_time_approval_items_guard();
DROP FUNCTION public.tg_engagement_time_approvals_guard();

-- ── 6. Policy audit survives a policy DELETE (D23) ─────────────────────────
-- A team override DELETE (and any cascade from a team or workspace) used to
-- cascade its audit rows away. The events now keep the scope and the owner ids
-- themselves, and a BEFORE DELETE trigger writes a "deleted" event.
ALTER TABLE public.time_policy_events
  ALTER COLUMN policy_id DROP NOT NULL,
  DROP CONSTRAINT time_policy_events_policy_id_fkey,
  ADD CONSTRAINT time_policy_events_policy_id_fkey FOREIGN KEY (policy_id)
    REFERENCES public.time_policies(id) ON DELETE SET NULL,
  ADD COLUMN scope text,
  ADD COLUMN team_id uuid,
  ADD COLUMN workspace_id uuid;

UPDATE public.time_policy_events e
   SET scope = p.scope, team_id = p.team_id, workspace_id = p.workspace_id
  FROM public.time_policies p
 WHERE p.id = e.policy_id;

CREATE INDEX time_policy_events_team_idx
  ON public.time_policy_events (team_id, created_at DESC) WHERE team_id IS NOT NULL;
CREATE INDEX time_policy_events_workspace_idx
  ON public.time_policy_events (workspace_id, created_at DESC) WHERE workspace_id IS NOT NULL;

-- trg_time_policies_events: M1 body (20261003090100:1277-1305); every event now
-- also copies scope, team_id and workspace_id.
CREATE OR REPLACE FUNCTION public.tg_time_policies_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changes jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_changes := to_jsonb(NEW) - 'updated_at';
  ELSE
    SELECT jsonb_object_agg(n.key, jsonb_build_array(o.value, n.value))
    INTO v_changes
    -- updated_by stays in the diff: an admin confirming the policy unchanged
    -- ("Looks right") only sets it, and that confirmation is worth a row.
    FROM jsonb_each(to_jsonb(NEW) - 'updated_at') n
    JOIN jsonb_each(to_jsonb(OLD) - 'updated_at') o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value;
    IF v_changes IS NULL THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public.time_policy_events (policy_id, actor_user_id, changes, scope, team_id, workspace_id)
  VALUES (NEW.id, coalesce(NEW.updated_by, NEW.created_by), v_changes, NEW.scope, NEW.team_id, NEW.workspace_id);
  RETURN NULL;
END;
$$;

-- trg_time_policies_delete_event: the last audit row of a deleted policy. The
-- actor is the caller of time_policy_delete, else the row's last editor (a
-- cascade from a team or workspace delete has no caller).
CREATE FUNCTION public.tg_time_policies_delete_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.time_policy_events (policy_id, actor_user_id, changes, scope, team_id, workspace_id)
  VALUES (OLD.id,
          coalesce(nullif(current_setting('app.time_policy_actor', true), '')::uuid, OLD.updated_by),
          jsonb_build_object('deleted', true, 'row', to_jsonb(OLD) - 'updated_at'),
          OLD.scope, OLD.team_id, OLD.workspace_id);
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_time_policies_delete_event
  BEFORE DELETE ON public.time_policies
  FOR EACH ROW EXECUTE FUNCTION public.tg_time_policies_delete_event();

-- The team override DELETE path: records who deleted it.
CREATE FUNCTION public.time_policy_delete(p_policy_id uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev_actor text := current_setting('app.time_policy_actor', true);
BEGIN
  PERFORM set_config('app.time_policy_actor', coalesce(p_actor::text, ''), true);
  DELETE FROM public.time_policies WHERE id = p_policy_id;
  PERFORM set_config('app.time_policy_actor', coalesce(v_prev_actor, ''), true);
END;
$$;

-- ── 10. Carry-over: M2 and M1 bodies on the new names ──────────────────────
-- Bodies are the M2 file's (20261003100000_time_timesheets_backfill.sql) with
-- only this map applied, checked by check_carryover.mjs:
--   task_time_logs -> time_entries; reviewed_by -> legacy_reviewed_by;
--   reviewed_at -> legacy_reviewed_at; review_note -> legacy_review_note
-- (word-bounded, so max_reviewed_at and p_created_by are untouched).
-- tg_time_entries_timesheet and time_legacy_approver_scope name no entry table
-- and no reviewer column, so they are not rebuilt. CREATE OR REPLACE keeps
-- every ACL; the tail re-asserts them.

-- trg_time_entries_40_lock (M2 body). The allowed keys and the reviewer FK-cascade
-- allowance follow the column rename to legacy_reviewed_*.
CREATE OR REPLACE FUNCTION public.tg_time_entries_lock()
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
                            'status', 'legacy_reviewed_by', 'legacy_reviewed_at', 'legacy_review_note'];
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
  IF OLD.legacy_reviewed_by IS NOT NULL AND NEW.legacy_reviewed_by IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = OLD.legacy_reviewed_by) THEN
    v_allowed := v_allowed || ARRAY['legacy_reviewed_by'];
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

-- Facts of one sheet's entries (M2 body).
CREATE OR REPLACE FUNCTION public.time_legacy_sheet_facts(p_timesheet_id uuid)
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
         min(e.created_at), max(e.created_at), max(e.legacy_reviewed_at), max(e.updated_at),
         (array_agg(e.legacy_reviewed_by ORDER BY e.legacy_reviewed_at DESC NULLS LAST, e.updated_at DESC)
            FILTER (WHERE e.legacy_reviewed_by IS NOT NULL))[1]
  FROM public.time_entries e
  WHERE e.timesheet_id = p_timesheet_id;
$$;

-- D13 freeze of an imported approved sheet (M2 body).
CREATE OR REPLACE FUNCTION public.time_legacy_freeze(p_timesheet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.time_entries e
     SET payable_seconds = v.ps,
         amount_snapshot = CASE WHEN coalesce(e.rate_type_snapshot, 'hourly') = 'hourly'
                                THEN round(v.ps / 3600.0 * coalesce(e.rate_snapshot, 0), 2) END
    FROM (SELECT x.id, CASE WHEN x.legacy_status = 'rejected' THEN 0
                            ELSE coalesce(x.duration_seconds, 0) END AS ps
            FROM public.time_entries x
           WHERE x.timesheet_id = p_timesheet_id) v
   WHERE e.id = v.id;
END;
$$;

-- Grouping and classification (M2) or reconcile (M4, after a rollback) (M2 body).
CREATE OR REPLACE FUNCTION public.time_legacy_backfill(p_reconcile boolean)
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
    FROM public.time_entries e
    WHERE e.context_kind <> 'personal' AND e.timesheet_id IS NULL
    ORDER BY e.member_user_id, e.started_at, e.id
  LOOP
    SELECT * INTO sc FROM public.time_sheet_scope_for(r.context_kind, r.context_ref, r.project_id);
    IF sc.scope_kind IS NULL THEN
      PERFORM public.time_raise('TIMESHEET_SCOPE_REQUIRED', jsonb_build_object('entry_id', r.id));
    END IF;
    UPDATE public.time_entries e
       SET timesheet_id = public.time_ensure_timesheet(r.member_user_id, sc.scope_kind, sc.scope_ref,
                                                       sc.policy_workspace_id, r.started_at)
     WHERE e.id = r.id;
  END LOOP;

  -- B. Markers by fact on every grouped entry (D18). In reconcile mode a newly
  -- rejected entry returns its sheet instead of being marked.
  IF NOT p_reconcile THEN
    UPDATE public.time_entries e SET legacy_status = 'rejected'
     WHERE e.status = 'rejected' AND e.legacy_status IS NULL AND e.timesheet_id IS NOT NULL;
  END IF;
  UPDATE public.time_entries e SET legacy_status = 'paid_outside'
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
                                  FROM public.time_entries e
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
                    JOIN public.time_entries e ON e.timesheet_id = v.timesheet_id
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
                                  FROM public.time_entries e
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

-- Payout RPCs, build #2: the build #1 bodies (M2) on time_entries and
-- legacy_reviewed_*. They still write status and the legacy reviewer until M5.
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
    FROM public.time_entries
   WHERE id = ANY (p_log_ids)
     AND team_id = p_team_id
     AND member_user_id = p_member_user_id
     AND context_kind = 'team' AND legacy_status IS NULL AND (payable_seconds IS NOT NULL OR status = 'approved')
     AND payout_id IS NULL
     AND currency_snapshot = p_currency
   FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.time_entries
     WHERE id = ANY (p_log_ids)
       AND rate_type_snapshot = 'fixed'
  ) THEN
    PERFORM public.time_raise('FIXED_RATE_NOT_PAYABLE_BY_ENTRY');
  END IF;

  -- Validate + compute the authoritative total over the now-locked rows.
  SELECT count(*),
         COALESCE(round(sum(COALESCE(payable_seconds, duration_seconds, 0) / 3600.0 * rate_snapshot), 2), 0)
    INTO v_matched, v_total
    FROM public.time_entries
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
  UPDATE public.time_entries
     SET status = 'paid',
         payout_id = v_payout.id,
         legacy_reviewed_by = p_created_by,
         legacy_reviewed_at = now(),
         updated_at = now()
   WHERE id = ANY (p_log_ids);
  PERFORM set_config('app.time_settlement', coalesce(v_prev_settlement, ''), true);

  RETURN v_payout;
END $$;

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
  UPDATE public.time_entries
     SET status = 'approved',
         payout_id = NULL,
         legacy_reviewed_by = p_actor,
         legacy_reviewed_at = now(),
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

-- trg_timesheets_guard (M1 body, 20261003090100:1067-1185): only the entry table name changes.
CREATE OR REPLACE FUNCTION public.tg_timesheets_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_maint boolean := coalesce(current_setting('app.time_maintenance', true), '') = 'on';
  v_legacy boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RAISE EXCEPTION 'TIMESHEET_TRANSITION_INVALID' USING DETAIL = 'a timesheet is created open';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_maint THEN
      RETURN OLD;
    END IF;
    IF OLD.status <> 'open' OR EXISTS (
      SELECT 1 FROM public.time_entries l WHERE l.timesheet_id = OLD.id) THEN
      RAISE EXCEPTION 'TIMESHEET_DELETE_FORBIDDEN';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
     OR NEW.scope_ref IS DISTINCT FROM OLD.scope_ref
     OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
     OR NEW.period_start IS DISTINCT FROM OLD.period_start
     OR NEW.period_end IS DISTINCT FROM OLD.period_end
     OR NEW.timezone IS DISTINCT FROM OLD.timezone
     OR NEW.week_start IS DISTINCT FROM OLD.week_start
     OR NEW.origin IS DISTINCT FROM OLD.origin
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'TIMESHEET_IMMUTABLE';
  END IF;

  -- These may only become NULL, and only when the referenced row is gone.
  IF (NEW.member_user_id IS DISTINCT FROM OLD.member_user_id
        AND (NEW.member_user_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.member_user_id)))
     OR (NEW.team_id IS DISTINCT FROM OLD.team_id
        AND (NEW.team_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM public.teams WHERE id = OLD.team_id)))
     OR (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        AND (NEW.workspace_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id)))
     OR (NEW.policy_workspace_id IS DISTINCT FROM OLD.policy_workspace_id
        AND (NEW.policy_workspace_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.policy_workspace_id))) THEN
    RAISE EXCEPTION 'TIMESHEET_IMMUTABLE' USING DETAIL = 'identity columns only clear on cascade';
  END IF;

  -- approver_scope is frozen at submit: it may only be set on the way into
  -- submitted (or cleared when a sheet goes back to open / returned).
  IF NEW.approver_scope IS DISTINCT FROM OLD.approver_scope AND NOT v_maint
     AND NOT (NEW.status = 'submitted' AND OLD.status IN ('open', 'returned'))
     AND NOT (NEW.status IN ('open', 'returned') AND NEW.approver_scope IS NULL) THEN
    RAISE EXCEPTION 'TIMESHEET_IMMUTABLE' USING DETAIL = 'approver_scope is frozen at submit';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_legacy := v_maint AND NEW.origin = 'legacy_migration';
    IF NOT (
      (OLD.status, NEW.status) IN (('open', 'submitted'), ('returned', 'submitted'),
                                   ('submitted', 'approved'), ('submitted', 'open'),
                                   ('submitted', 'returned'), ('approved', 'returned'),
                                   ('approved', 'open'))
      OR (v_legacy AND (OLD.status, NEW.status) = ('open', 'approved'))
    ) THEN
      RAISE EXCEPTION 'TIMESHEET_TRANSITION_INVALID'
        USING DETAIL = format('%s -> %s', OLD.status, NEW.status);
    END IF;

    IF NEW.status = 'approved' THEN
      IF NEW.decision_kind = 'manual' THEN
        IF NEW.decided_by IS NULL OR NOT public.time_can_decide_scope(
             NEW.approver_scope, NEW.team_id, NEW.policy_workspace_id,
             NEW.engagement_id, NEW.member_user_id, NEW.decided_by) THEN
          RAISE EXCEPTION 'TIMESHEET_DECIDER_INVALID';
        END IF;
      ELSIF NEW.decision_kind = 'self' THEN
        IF NEW.approver_scope IS DISTINCT FROM 'self' OR NEW.decided_by IS DISTINCT FROM NEW.member_user_id THEN
          RAISE EXCEPTION 'TIMESHEET_DECIDER_INVALID';
        END IF;
      ELSIF NEW.decision_kind = 'auto' THEN
        IF NEW.approver_scope IS DISTINCT FROM 'auto' OR NEW.decided_by IS NOT NULL THEN
          RAISE EXCEPTION 'TIMESHEET_DECIDER_INVALID';
        END IF;
      ELSIF NEW.decision_kind = 'legacy' THEN
        -- Legacy import skips the decider check; decided_by may be NULL or
        -- even the member (one prod sheet's last reviewer is the member).
        IF NOT v_maint THEN
          RAISE EXCEPTION 'TIMESHEET_DECIDER_INVALID' USING DETAIL = 'legacy decisions are migration-only';
        END IF;
      END IF;
    ELSIF NEW.status = 'returned' AND NOT v_maint THEN
      IF NEW.decided_by IS NULL OR NOT public.time_can_decide_scope(
           NEW.approver_scope, NEW.team_id, NEW.policy_workspace_id,
           NEW.engagement_id, NEW.member_user_id, NEW.decided_by) THEN
        RAISE EXCEPTION 'TIMESHEET_DECIDER_INVALID';
      END IF;
    ELSIF OLD.status = 'approved' AND NEW.status = 'open' AND NOT v_maint THEN
      -- A member reopens only their own auto or self sheet.
      IF OLD.approver_scope NOT IN ('auto', 'self') THEN
        RAISE EXCEPTION 'TIMESHEET_TRANSITION_INVALID' USING DETAIL = 'only auto or self sheets reopen to open';
      END IF;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- trg_invoice_time_entries_guard (M1 body, 20261003090100:1193-1230): the entry table name
-- changes, and a DELETE under app.time_maintenance always passes (D22), so
-- time_test_cleanup and reset_qa_fixture can clear reservations.
CREATE OR REPLACE FUNCTION public.tg_invoice_time_entries_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv_status text;
  v_inv_contract uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('app.time_maintenance', true), '') = 'on' THEN
      RETURN OLD;
    END IF;
    SELECT i.status INTO v_inv_status FROM public.invoices i WHERE i.id = OLD.invoice_id;
    IF FOUND AND v_inv_status NOT IN ('draft', 'void') THEN
      RAISE EXCEPTION 'INVOICE_TIME_ENTRY_NOT_BILLABLE' USING DETAIL = 'reservation is locked by an issued invoice';
    END IF;
    RETURN OLD;
  END IF;

  SELECT i.status, i.contract_id INTO v_inv_status, v_inv_contract
  FROM public.invoices i WHERE i.id = NEW.invoice_id;
  IF NOT FOUND OR v_inv_status <> 'draft' OR v_inv_contract IS DISTINCT FROM NEW.contract_id THEN
    RAISE EXCEPTION 'INVOICE_TIME_ENTRY_NOT_BILLABLE' USING DETAIL = 'target invoice must be a draft of the same contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.time_entries l
    WHERE l.id = NEW.entry_id
      AND l.payable_seconds IS NOT NULL
      AND l.legacy_status IS DISTINCT FROM 'rejected'
      AND l.context_kind <> 'personal'
      AND coalesce(l.work_type_snapshot, 'real_work') <> 'training'
  ) THEN
    RAISE EXCEPTION 'INVOICE_TIME_ENTRY_NOT_BILLABLE' USING DETAIL = 'entry is not approved billable time';
  END IF;

  RETURN NEW;
END;
$$;

-- ── 20. Timesheet engine (P02B) ─────────────────────────────────────────────
-- blueprint §2.10 and §3 P02B; sql.md §2.3 and §2.4; decisions D09-D16, D52.
--
-- Every timesheet status change goes through time_timesheet_transition: ordered
-- row locks, the expected-revision check, ownership or decider checks, routing
-- at submit (approver_scope frozen on the sheet), the freeze under
-- app.time_freeze, one timesheet_events row per step, revision + 1 per step.
-- Until M5 the engine mirrors decisions into time_entries.status (approve,
-- reopen and return), skipping assignment rows (trg_20 fires on UPDATE OF
-- status). The engine never sets app.time_maintenance.
--
-- Order matters: SQL-language bodies are validated at creation, so each helper
-- precedes its first SQL caller (time_route_sheet before
-- time_sheet_routing_preview; this whole section before 30_group_a).
--
-- Privileges: every function is SECURITY DEFINER with a pinned search_path and
-- revoked from PUBLIC, anon, authenticated. The RPCs of §2.10 are granted to
-- service_role. time_route_sheet, time_apply_freeze and time_clear_freeze are
-- internal (REVOKE only): they run inside the SECURITY DEFINER transition and
-- the routing preview, and the freeze helpers would otherwise let a direct
-- call set the freeze columns outside a transition. Supabase's default
-- privileges grant EXECUTE on every new public function to service_role as
-- well, so their REVOKE names service_role too (the definer callers run as
-- the owner and keep access).
--
-- Self-review checklist (P02B acceptance):
--   [x] Every function SECURITY DEFINER, SET search_path = public, pg_temp,
--       followed by its REVOKE (and GRANT for the RPCs).
--   [x] Every new raise goes through time_raise(code, detail).
--   [x] TIMESHEET_TRANSITION_INVALID reasons used are exactly the §2.10 list:
--       action, arguments, note_too_long, not_allowed, state, empty,
--       running_entry, too_early, not_auto, note_required, freeze_required,
--       freeze_invalid, use_request_reopen.
--   [x] Detail keys never use message, status, path or timestamp (D50).
--   [x] Every status mirror statement is filtered engagement_assignment_id IS NULL.
--   [x] No body names a pre-M3 table name; time_entries is aliased e / te.

-- Cost money (D12, structural): a team entry whose team pays member rates on a
-- workspace with time_team_rules, or an assignment entry under a talent
-- engagement.
CREATE FUNCTION public.time_sheet_has_cost_money(p_timesheet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
           SELECT 1
           FROM public.time_entries e
           JOIN public.teams tm ON tm.id = e.context_ref
           WHERE e.timesheet_id = p_timesheet_id
             AND e.context_kind = 'team'
             AND tm.member_rates_enabled
             AND public.time_workspace_has_feature(tm.workspace_id, 'time_team_rules'))
      OR EXISTS (
           SELECT 1
           FROM public.time_entries e
           JOIN public.engagement_assignments a ON a.id = e.context_ref
           WHERE e.timesheet_id = p_timesheet_id
             AND e.context_kind = 'assignment'
             AND a.talent_engagement_id IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION public.time_sheet_has_cost_money(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.time_sheet_has_cost_money(uuid) TO service_role;

-- The eligible deciders for a frozen approver scope (D11: the single source;
-- counts are count(*) over it). Candidates: the team owner, team owner/admin
-- members, owner/admin members of the policy workspace, the engagement's hirer
-- parties; never the member, never a tombstoned profile; each must pass
-- time_can_decide_scope.
CREATE FUNCTION public.time_scope_deciders(
  p_approver_scope text,
  p_team_id uuid,
  p_policy_workspace_id uuid,
  p_engagement_id uuid,
  p_member_user_id uuid
)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c.user_id
  FROM (
    SELECT tm.owner_id AS user_id
    FROM public.teams tm
    WHERE tm.id = p_team_id
    UNION
    SELECT m.user_id
    FROM public.team_members m
    WHERE m.team_id = p_team_id AND m.role IN ('owner', 'admin')
    UNION
    SELECT w.user_id
    FROM public.workspace_members w
    WHERE w.workspace_id = p_policy_workspace_id AND w.role IN ('owner', 'admin')
    UNION
    SELECT ep.user_id
    FROM public.engagement_parties ep
    WHERE ep.engagement_id = p_engagement_id AND ep.position = 'hirer'
  ) c
  JOIN public.profiles p ON p.id = c.user_id AND p.deleted_at IS NULL
  WHERE c.user_id IS DISTINCT FROM p_member_user_id
    AND public.time_can_decide_scope(p_approver_scope, p_team_id, p_policy_workspace_id,
                                     p_engagement_id, p_member_user_id, c.user_id)
  ORDER BY c.user_id;
$$;
REVOKE ALL ON FUNCTION public.time_scope_deciders(text, uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.time_scope_deciders(text, uuid, uuid, uuid, uuid) TO service_role;

-- A sheet's deciders, from its frozen columns (empty while open: approver_scope
-- is NULL).
CREATE FUNCTION public.time_timesheet_deciders(p_timesheet_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT d.user_id
  FROM public.timesheets t
  CROSS JOIN LATERAL public.time_scope_deciders(t.approver_scope, t.team_id, t.policy_workspace_id,
                                                t.engagement_id, t.member_user_id) AS d(user_id)
  WHERE t.id = p_timesheet_id;
$$;
REVOKE ALL ON FUNCTION public.time_timesheet_deciders(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.time_timesheet_deciders(uuid) TO service_role;

-- A user's approval queue. 'submitted': sheets waiting on them, prefiltered by
-- what they manage (teams, policy workspaces, hirer engagements), then the
-- exact decider test. 'decided': sheets they decided (never their own) since
-- p_since, default the last 30 days. Any other status: no rows.
CREATE FUNCTION public.time_approval_queue_ids(
  p_user_id uuid,
  p_status text DEFAULT 'submitted',
  p_since date DEFAULT NULL
)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id
  FROM public.timesheets t
  WHERE p_user_id IS NOT NULL
    AND p_status = 'submitted'
    AND t.status = 'submitted'
    AND t.member_user_id IS DISTINCT FROM p_user_id
    AND (t.team_id IN (SELECT tm.id FROM public.teams tm WHERE tm.owner_id = p_user_id
                       UNION
                       SELECT m.team_id FROM public.team_members m
                       WHERE m.user_id = p_user_id AND m.role IN ('owner', 'admin'))
         OR t.policy_workspace_id IN (SELECT w.workspace_id FROM public.workspace_members w
                                      WHERE w.user_id = p_user_id AND w.role IN ('owner', 'admin'))
         OR t.engagement_id IN (SELECT ep.engagement_id FROM public.engagement_parties ep
                                WHERE ep.user_id = p_user_id AND ep.position = 'hirer'))
    AND public.time_can_decide_scope(t.approver_scope, t.team_id, t.policy_workspace_id,
                                     t.engagement_id, t.member_user_id, p_user_id)
  UNION ALL
  SELECT t.id
  FROM public.timesheets t
  WHERE p_user_id IS NOT NULL
    AND p_status = 'decided'
    AND t.decided_by = p_user_id
    AND t.member_user_id IS DISTINCT FROM p_user_id
    AND t.decided_at >= coalesce(p_since, current_date - 30);
$$;
REVOKE ALL ON FUNCTION public.time_approval_queue_ids(uuid, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.time_approval_queue_ids(uuid, text, date) TO service_role;

-- Stops running entries (sql.md §2.4; same arithmetic as the timer stop):
-- stop = greatest(p_at, started_at + 1s); an in-progress pause is folded into
-- break_seconds; the open segment closes at stop; duration = gross - break.
-- Only rows still running are touched. Returns the number stopped.
CREATE FUNCTION public.time_stop_running_entries(
  p_ids uuid[],
  p_at timestamptz DEFAULT now(),
  p_flag text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  v_stop timestamptz;
  v_brk integer;
  v_n integer := 0;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT e.id, e.started_at, e.paused_at, e.break_seconds
    FROM public.time_entries e
    WHERE e.id = ANY (p_ids) AND e.ended_at IS NULL
    ORDER BY e.id
    FOR UPDATE
  LOOP
    v_stop := greatest(coalesce(p_at, now()), r.started_at + interval '1 second');
    v_brk := greatest(coalesce(r.break_seconds, 0), 0);
    IF r.paused_at IS NOT NULL THEN
      v_brk := v_brk + greatest(0, floor(extract(epoch FROM (v_stop - r.paused_at)))::integer);
    END IF;

    UPDATE public.time_entry_segments sg
       SET ended_at = greatest(v_stop, sg.started_at)
     WHERE sg.entry_id = r.id AND sg.ended_at IS NULL;

    UPDATE public.time_entries e
       SET ended_at = v_stop,
           paused_at = NULL,
           break_seconds = v_brk,
           break_minutes = round(v_brk / 60.0)::integer,
           duration_seconds = greatest(0, floor(extract(epoch FROM (v_stop - r.started_at)))::integer - v_brk),
           flagged_reason = coalesce(p_flag, e.flagged_reason)
     WHERE e.id = r.id AND e.ended_at IS NULL;
    IF FOUND THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;

  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.time_stop_running_entries(uuid[], timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.time_stop_running_entries(uuid[], timestamptz, text) TO service_role;

-- Applies one sheet's freeze (sql.md §2.3 body). p_freeze is
-- {"<entry id>": {payable_seconds, rate_snapshot, rate_type_snapshot,
-- currency_snapshot, amount_snapshot}}; its keys must equal the sheet's entry
-- ids (STALE_REVISION {reason: entry_set}). Only the NULL-ness of
-- amount_snapshot is used: the amount is recomputed, so the cents are
-- canonical. Entries created before the first legacy_import keep their stored
-- rate, type and currency (D13); legacy_status 'rejected' counts 0. Then the
-- approve mirror (until M5).
CREATE FUNCTION public.time_apply_freeze(p_timesheet_id uuid, p_freeze jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev text := current_setting('app.time_freeze', true);
  v_cut timestamptz := (SELECT min(v.created_at) FROM public.timesheet_events v WHERE v.event = 'legacy_import');
BEGIN
  IF jsonb_typeof(p_freeze) IS DISTINCT FROM 'object' THEN
    PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                              jsonb_build_object('reason', 'freeze_required', 'timesheet_id', p_timesheet_id));
  END IF;
  -- A key that is not a uuid would otherwise fail the cast below with a raw 22P02.
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_freeze) k
             WHERE k !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN
    PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                              jsonb_build_object('reason', 'freeze_invalid', 'timesheet_id', p_timesheet_id));
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS time_freeze_rows (
    id uuid, ps numeric, rate numeric, rtype text, cur text, priced boolean
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.time_freeze_rows;
  -- CASE guards: SQL does not short-circuit casts.
  INSERT INTO pg_temp.time_freeze_rows (id, ps, rate, rtype, cur, priced)
  SELECT f.key::uuid,
         CASE WHEN jsonb_typeof(f.value -> 'payable_seconds') = 'number' THEN (f.value ->> 'payable_seconds')::numeric END,
         CASE WHEN jsonb_typeof(f.value -> 'rate_snapshot') = 'number' THEN (f.value ->> 'rate_snapshot')::numeric END,
         f.value ->> 'rate_type_snapshot',
         nullif(btrim(f.value ->> 'currency_snapshot'), ''),
         CASE jsonb_typeof(f.value -> 'amount_snapshot') WHEN 'number' THEN true WHEN 'null' THEN false END
  FROM jsonb_each(p_freeze) f;

  IF EXISTS (SELECT 1 FROM public.time_entries e
             WHERE e.timesheet_id = p_timesheet_id
               AND NOT EXISTS (SELECT 1 FROM pg_temp.time_freeze_rows f WHERE f.id = e.id))
     OR EXISTS (SELECT 1 FROM pg_temp.time_freeze_rows f
                WHERE NOT EXISTS (SELECT 1 FROM public.time_entries e
                                  WHERE e.id = f.id AND e.timesheet_id = p_timesheet_id)) THEN
    PERFORM public.time_raise('STALE_REVISION',
                              jsonb_build_object('reason', 'entry_set', 'timesheet_id', p_timesheet_id));
  END IF;

  IF EXISTS (SELECT 1 FROM pg_temp.time_freeze_rows f JOIN public.time_entries e ON e.id = f.id
             WHERE e.ended_at IS NULL OR f.ps IS NULL OR f.ps < 0 OR f.ps <> trunc(f.ps)
                OR f.ps > coalesce(e.duration_seconds, 0) + 900   -- nearest 30-min rounding adds at most 15 min
                OR f.rate IS NULL OR f.rate < 0 OR coalesce(f.rtype, '') NOT IN ('hourly', 'fixed')
                OR f.cur IS NULL OR f.priced IS NULL OR (f.rtype = 'fixed' AND f.priced)) THEN
    PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                              jsonb_build_object('reason', 'freeze_invalid', 'timesheet_id', p_timesheet_id));
  END IF;

  PERFORM set_config('app.time_freeze', 'on', true);

  WITH v AS (
    SELECT e.id,
           e.created_at < v_cut AS legacy,
           CASE WHEN e.created_at < v_cut THEN e.rate_snapshot ELSE f.rate END AS rate,
           CASE WHEN e.created_at < v_cut THEN e.rate_type_snapshot ELSE f.rtype END AS rtype,
           CASE WHEN e.created_at < v_cut THEN e.currency_snapshot ELSE f.cur END AS cur,
           CASE WHEN e.legacy_status = 'rejected' THEN 0 ELSE f.ps::integer END AS ps,
           f.priced
    FROM public.time_entries e
    JOIN pg_temp.time_freeze_rows f ON f.id = e.id
  )
  UPDATE public.time_entries e
     SET rate_snapshot = v.rate,
         rate_type_snapshot = v.rtype,
         currency_snapshot = v.cur,
         payable_seconds = v.ps,
         amount_snapshot = CASE WHEN v.rtype = 'hourly' AND (v.priced OR v.legacy)
                                THEN round(v.ps / 3600.0 * v.rate, 2) END
    FROM v
   WHERE e.id = v.id;

  -- Status mirror (M5 deletes this statement).
  UPDATE public.time_entries e
     SET status = m.s
    FROM (SELECT te.id,
                 CASE WHEN te.legacy_status = 'rejected' THEN 'rejected'
                      WHEN te.payout_id IS NOT NULL OR te.legacy_status = 'paid_outside' THEN 'paid'
                      ELSE 'approved' END AS s
          FROM public.time_entries te
          WHERE te.timesheet_id = p_timesheet_id
            AND te.engagement_assignment_id IS NULL) m
   WHERE e.id = m.id
     AND e.status IS DISTINCT FROM m.s;

  PERFORM set_config('app.time_freeze', coalesce(v_prev, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION public.time_apply_freeze(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Clears one sheet's freeze on reopen: payable and amount to NULL, the legacy
-- 'rejected' marker cleared ('paid_outside' stays: a settled sheet never
-- reaches here). Then the reopen mirror (until M5).
CREATE FUNCTION public.time_clear_freeze(p_timesheet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev text := current_setting('app.time_freeze', true);
BEGIN
  PERFORM set_config('app.time_freeze', 'on', true);

  UPDATE public.time_entries e
     SET payable_seconds = NULL,
         amount_snapshot = NULL,
         legacy_status = nullif(e.legacy_status, 'rejected')
   WHERE e.timesheet_id = p_timesheet_id
     AND (e.payable_seconds IS NOT NULL OR e.legacy_status = 'rejected');

  -- Status mirror (M5 deletes this statement).
  UPDATE public.time_entries e
     SET status = 'pending'
   WHERE e.timesheet_id = p_timesheet_id
     AND e.status IN ('approved', 'rejected')
     AND e.payout_id IS NULL
     AND e.engagement_assignment_id IS NULL;

  PERFORM set_config('app.time_freeze', coalesce(v_prev, ''), true);
END;
$$;
REVOKE ALL ON FUNCTION public.time_clear_freeze(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Routing at submit (data-model › Approver Scope at Submit; backend › Routing).
-- Returns {approver_scope, routing: {base, cost_money, deciders_count, fallback}}.
--   base: engagement -> hirer (talent) or auto (client); team -> team when the
--         sheet has a live team and the resolved policy says approver 'team',
--         else workspace; workspace -> workspace.
--   no cost money and approval_required = false (team/workspace base) -> auto.
--   nobody else can decide the base: no money -> self (submit, auto_submit) or
--   auto (submit_on_deletion, D14); money on a team base -> workspace when
--   someone there can decide; otherwise the base stays, fallback 'wait'.
-- Internal: called by time_timesheet_transition and time_sheet_routing_preview.
CREATE FUNCTION public.time_route_sheet(p_sheet public.timesheets, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pol jsonb;
  v_money boolean;
  v_base text;
  v_scope text;
  v_n integer := 0;
  v_fallback text := 'none';
BEGIN
  IF p_sheet.id IS NULL THEN
    RETURN NULL;
  END IF;

  v_pol := public.time_resolve_policy(p_sheet.scope_kind, p_sheet.scope_ref, p_sheet.policy_workspace_id,
                                      p_sheet.period_start::timestamp AT TIME ZONE p_sheet.timezone);
  v_money := public.time_sheet_has_cost_money(p_sheet.id);

  v_base := CASE p_sheet.scope_kind
    WHEN 'engagement' THEN
      CASE WHEN (SELECT g.kind FROM public.engagements g WHERE g.id = p_sheet.engagement_id) = 'talent_services'
           THEN 'hirer' ELSE 'auto' END
    WHEN 'team' THEN
      CASE WHEN p_sheet.team_id IS NOT NULL AND v_pol ->> 'approver_scope' = 'team'
           THEN 'team' ELSE 'workspace' END
    ELSE 'workspace'
  END;
  v_scope := v_base;

  IF v_base IN ('team', 'workspace') AND NOT v_money AND (v_pol ->> 'approval_required') = 'false' THEN
    v_scope := 'auto';
    v_fallback := 'auto';
  ELSIF v_base IN ('team', 'workspace', 'hirer') THEN
    SELECT count(*)::integer INTO v_n
    FROM public.time_scope_deciders(v_base, p_sheet.team_id, p_sheet.policy_workspace_id,
                                    p_sheet.engagement_id, p_sheet.member_user_id);
    IF v_n = 0 THEN
      IF NOT v_money THEN
        v_scope := CASE WHEN p_action = 'submit_on_deletion' THEN 'auto' ELSE 'self' END;
        v_fallback := v_scope;
      ELSE
        IF v_base = 'team' THEN
          SELECT count(*)::integer INTO v_n
          FROM public.time_scope_deciders('workspace', p_sheet.team_id, p_sheet.policy_workspace_id,
                                          p_sheet.engagement_id, p_sheet.member_user_id);
        END IF;
        IF v_n > 0 THEN
          v_scope := 'workspace';
          v_fallback := 'workspace';
        ELSE
          v_fallback := 'wait';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'approver_scope', v_scope,
    'routing', jsonb_build_object('base', v_base, 'cost_money', v_money,
                                  'deciders_count', v_n, 'fallback', v_fallback));
END;
$$;
REVOKE ALL ON FUNCTION public.time_route_sheet(public.timesheets, text) FROM PUBLIC, anon, authenticated, service_role;

-- D52: what submitting the sheet now would route to, without writing (cron
-- job 3 skips sheets whose approver_scope is not auto/self). Missing id: NULL.
CREATE FUNCTION public.time_sheet_routing_preview(p_timesheet_id uuid, p_action text DEFAULT 'auto_submit')
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.time_route_sheet(t, p_action)
  FROM public.timesheets t
  WHERE t.id = p_timesheet_id;
$$;
REVOKE ALL ON FUNCTION public.time_sheet_routing_preview(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.time_sheet_routing_preview(uuid, text) TO service_role;

-- The timesheet state machine (data-model › Transitions; backend › Timesheet
-- State Machine). All-or-nothing over p_ids; returns the final rows ordered by
-- id. Validation order: action, arguments, note length, ordered locks (missing
-- id -> TIMESHEET_NOT_FOUND), then per sheet in id order: visibility
-- (TIMESHEET_NOT_FOUND, never a 403), revision (paired with p_ids by index),
-- role (not_allowed), the per-action rules, the freeze entry set, settlement.
-- p_actor NULL is valid only for auto_submit and submit_on_deletion (which
-- require it) and for approve on an auto/self sheet (cron job 4, D09); then
-- p_expected_revisions may be NULL.
CREATE FUNCTION public.time_timesheet_transition(
  p_ids uuid[],
  p_actor uuid,
  p_action text,
  p_expected_revisions integer[],
  p_note text DEFAULT NULL,
  p_approve_overtime boolean DEFAULT false,
  p_freeze jsonb DEFAULT NULL
)
RETURNS SETOF public.timesheets
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer := cardinality(p_ids);
  v_note text := nullif(btrim(p_note), '');
  v_locked integer;
  v_missing uuid;
  v_id uuid;
  v_expected integer;
  s public.timesheets%ROWTYPE;
  v_from text;
  v_member boolean;
  v_entries integer;
  v_running integer;
  v_total integer;
  v_today date;
  v_pol jsonb;
  v_route jsonb;
  v_scope text;
  v_kind text;
  v_settled text;
BEGIN
  -- 1. Action.
  IF p_action IS NULL OR p_action NOT IN ('submit', 'auto_submit', 'submit_on_deletion', 'withdraw',
                                          'approve', 'return', 'reopen', 'request_reopen') THEN
    PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID', jsonb_build_object('reason', 'action'));
  END IF;

  -- 2. Arguments.
  IF p_ids IS NULL
     OR coalesce(v_n, 0) = 0
     OR array_position(p_ids, NULL::uuid) IS NOT NULL
     OR (SELECT count(DISTINCT x) FROM unnest(p_ids) AS u(x)) <> v_n
     OR (p_expected_revisions IS NULL AND p_actor IS NOT NULL)
     OR (p_expected_revisions IS NOT NULL
         AND (cardinality(p_expected_revisions) <> v_n
              OR array_position(p_expected_revisions, NULL::integer) IS NOT NULL))
     OR (p_actor IS NULL AND p_action NOT IN ('auto_submit', 'submit_on_deletion', 'approve'))
     OR (p_actor IS NOT NULL AND p_action IN ('auto_submit', 'submit_on_deletion'))
     OR (p_freeze IS NOT NULL AND jsonb_typeof(p_freeze) NOT IN ('object', 'null')) THEN
    PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID', jsonb_build_object('reason', 'arguments'));
  END IF;

  -- 3. Note length.
  IF p_note IS NOT NULL AND char_length(p_note) > 2000 THEN
    PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID', jsonb_build_object('reason', 'note_too_long'));
  END IF;

  -- 4. Ordered row locks.
  PERFORM 1 FROM public.timesheets t WHERE t.id = ANY (p_ids) ORDER BY t.id FOR UPDATE;
  GET DIAGNOSTICS v_locked = ROW_COUNT;
  IF v_locked <> v_n THEN
    SELECT u.x INTO v_missing
    FROM unnest(p_ids) AS u(x)
    WHERE NOT EXISTS (SELECT 1 FROM public.timesheets t WHERE t.id = u.x)
    ORDER BY u.x
    LIMIT 1;
    PERFORM public.time_raise('TIMESHEET_NOT_FOUND', jsonb_build_object('timesheet_id', v_missing));
  END IF;

  FOR v_id IN SELECT u.x FROM unnest(p_ids) AS u(x) ORDER BY u.x LOOP
    SELECT * INTO s FROM public.timesheets t WHERE t.id = v_id;
    v_from := s.status;
    v_member := p_actor IS NOT NULL AND p_actor IS NOT DISTINCT FROM s.member_user_id;

    -- 5. Visibility: a miss, never a 403.
    IF p_actor IS NOT NULL AND NOT v_member AND NOT public.can_view_timesheet(s.id, p_actor) THEN
      PERFORM public.time_raise('TIMESHEET_NOT_FOUND', jsonb_build_object('timesheet_id', s.id));
    END IF;

    -- 6. Revision, paired with p_ids by original index.
    IF p_expected_revisions IS NOT NULL THEN
      v_expected := p_expected_revisions[array_position(p_ids, v_id)];
      IF v_expected IS DISTINCT FROM s.revision THEN
        PERFORM public.time_raise('STALE_REVISION',
                                  jsonb_build_object('timesheet_id', s.id, 'expected', v_expected,
                                                     'actual', s.revision));
      END IF;
    END IF;

    -- 7. Role. reopen takes the member path when the actor is the member.
    IF (p_action IN ('submit', 'withdraw', 'request_reopen') AND NOT v_member)
       OR ((p_action = 'return' OR (p_action = 'approve' AND p_actor IS NOT NULL)
            OR (p_action = 'reopen' AND NOT v_member))
           AND NOT public.can_decide_timesheet(s.id, p_actor)) THEN
      PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                jsonb_build_object('reason', 'not_allowed', 'timesheet_id', s.id));
    END IF;

    -- 8-10. Per-action rules, freeze entry set (time_apply_freeze), settlement.
    IF p_action IN ('submit', 'auto_submit', 'submit_on_deletion') THEN
      IF NOT (s.status = 'open' OR (s.status = 'returned' AND p_action <> 'auto_submit')) THEN
        PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                  jsonb_build_object('reason', 'state', 'timesheet_id', s.id,
                                                     'sheet_status', s.status));
      END IF;

      SELECT count(*)::integer,
             (count(*) FILTER (WHERE e.ended_at IS NULL))::integer,
             coalesce(sum(coalesce(e.duration_seconds, 0)), 0)::integer
        INTO v_entries, v_running, v_total
      FROM public.time_entries e
      WHERE e.timesheet_id = s.id;
      IF v_entries = 0 THEN
        PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                  jsonb_build_object('reason', 'empty', 'timesheet_id', s.id));
      END IF;
      IF v_running > 0 THEN
        PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                  jsonb_build_object('reason', 'running_entry', 'timesheet_id', s.id));
      END IF;

      v_pol := public.time_resolve_policy(s.scope_kind, s.scope_ref, s.policy_workspace_id,
                                          s.period_start::timestamp AT TIME ZONE s.timezone);
      v_route := public.time_route_sheet(s, p_action);
      v_scope := v_route ->> 'approver_scope';
      v_today := (now() AT TIME ZONE s.timezone)::date;

      -- D13: a manual-route submit waits for the period's last local day;
      -- auto/self may send early; resubmits and on_deletion have no timing rule.
      IF p_action = 'submit' AND s.status = 'open' AND v_scope NOT IN ('auto', 'self')
         AND v_today < s.period_end THEN
        PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                  jsonb_build_object('reason', 'too_early', 'timesheet_id', s.id));
      END IF;
      IF p_action = 'auto_submit' THEN
        IF v_today < s.period_end + greatest(coalesce((v_pol ->> 'reminder_days')::integer, 1), 1) THEN
          PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                    jsonb_build_object('reason', 'too_early', 'timesheet_id', s.id));
        END IF;
        IF v_scope NOT IN ('auto', 'self') THEN
          PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                    jsonb_build_object('reason', 'not_auto', 'timesheet_id', s.id));
        END IF;
      END IF;

      UPDATE public.timesheets t
         SET status = 'submitted',
             approver_scope = v_scope,
             policy_snapshot = v_pol || jsonb_build_object('routing', v_route -> 'routing'),
             submitted_at = now(),
             submitted_by = CASE WHEN p_action = 'submit' THEN p_actor END,
             submission_kind = CASE p_action WHEN 'submit' THEN 'manual'
                                             WHEN 'auto_submit' THEN 'auto'
                                             ELSE 'on_deletion' END,
             total_seconds = v_total,
             decided_at = NULL,
             decided_by = NULL,
             decision_kind = NULL,
             decision_note = NULL,
             payable_seconds = NULL,
             overtime_approved = false,
             revision = t.revision + 1
       WHERE t.id = s.id
      RETURNING * INTO s;
      INSERT INTO public.timesheet_events (timesheet_id, actor_user_id, event, from_status, to_status, note,
                                           total_seconds, payable_seconds, revision)
      VALUES (s.id, p_actor, CASE WHEN p_action = 'auto_submit' THEN 'auto_submitted' ELSE 'submitted' END,
              v_from, s.status, v_note, s.total_seconds, s.payable_seconds, s.revision);

      -- Chain to approved: auto/self routes with a freeze for this sheet only
      -- (submit_on_deletion never chains; without a freeze cron job 4 finishes it).
      IF p_action IN ('submit', 'auto_submit') AND v_scope IN ('auto', 'self')
         AND p_freeze IS NOT NULL AND p_freeze ? s.id::text THEN
        PERFORM public.time_apply_freeze(s.id, p_freeze -> s.id::text);
        UPDATE public.timesheets t
           SET status = 'approved',
               decision_kind = v_scope,
               decided_by = CASE WHEN v_scope = 'self' THEN t.member_user_id END,
               decided_at = now(),
               decision_note = NULL,
               payable_seconds = (SELECT coalesce(sum(e.payable_seconds), 0)::integer
                                  FROM public.time_entries e
                                  WHERE e.timesheet_id = t.id
                                    AND e.legacy_status IS DISTINCT FROM 'rejected'),
               revision = t.revision + 1
         WHERE t.id = s.id
        RETURNING * INTO s;
        INSERT INTO public.timesheet_events (timesheet_id, actor_user_id, event, from_status, to_status, note,
                                             total_seconds, payable_seconds, revision)
        VALUES (s.id, p_actor, 'approved', 'submitted', s.status, NULL,
                s.total_seconds, s.payable_seconds, s.revision);
      END IF;

    ELSIF p_action = 'withdraw' THEN
      IF s.status <> 'submitted' THEN
        PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                  jsonb_build_object('reason', 'state', 'timesheet_id', s.id,
                                                     'sheet_status', s.status));
      END IF;
      UPDATE public.timesheets t
         SET status = 'open',
             approver_scope = NULL,
             policy_snapshot = '{}'::jsonb,
             submitted_at = NULL,
             submitted_by = NULL,
             submission_kind = NULL,
             total_seconds = NULL,
             decided_at = NULL,
             decided_by = NULL,
             decision_kind = NULL,
             decision_note = NULL,
             payable_seconds = NULL,
             overtime_approved = false,
             revision = t.revision + 1
       WHERE t.id = s.id
      RETURNING * INTO s;
      INSERT INTO public.timesheet_events (timesheet_id, actor_user_id, event, from_status, to_status, note,
                                           total_seconds, payable_seconds, revision)
      VALUES (s.id, p_actor, 'withdrawn', v_from, s.status, v_note, s.total_seconds, s.payable_seconds, s.revision);

    ELSIF p_action = 'approve' THEN
      IF s.status <> 'submitted' THEN
        PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                  jsonb_build_object('reason', 'state', 'timesheet_id', s.id,
                                                     'sheet_status', s.status));
      END IF;
      -- D09: a NULL actor (cron job 4) only finishes auto/self sheets.
      IF p_actor IS NULL AND s.approver_scope NOT IN ('auto', 'self') THEN
        PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                  jsonb_build_object('reason', 'not_auto', 'timesheet_id', s.id));
      END IF;
      IF EXISTS (SELECT 1 FROM public.time_entries e WHERE e.timesheet_id = s.id AND e.ended_at IS NULL) THEN
        PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                  jsonb_build_object('reason', 'running_entry', 'timesheet_id', s.id));
      END IF;
      IF p_freeze IS NULL OR NOT (p_freeze ? s.id::text) THEN
        PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                  jsonb_build_object('reason', 'freeze_required', 'timesheet_id', s.id));
      END IF;

      PERFORM public.time_apply_freeze(s.id, p_freeze -> s.id::text);
      v_kind := CASE WHEN p_actor IS NULL THEN s.approver_scope ELSE 'manual' END;
      UPDATE public.timesheets t
         SET status = 'approved',
             decision_kind = v_kind,
             decided_by = CASE WHEN p_actor IS NOT NULL THEN p_actor
                               WHEN v_kind = 'self' THEN t.member_user_id END,
             decided_at = now(),
             decision_note = v_note,
             overtime_approved = coalesce(p_approve_overtime, false),
             payable_seconds = (SELECT coalesce(sum(e.payable_seconds), 0)::integer
                                FROM public.time_entries e
                                WHERE e.timesheet_id = t.id
                                  AND e.legacy_status IS DISTINCT FROM 'rejected'),
             revision = t.revision + 1
       WHERE t.id = s.id
      RETURNING * INTO s;
      INSERT INTO public.timesheet_events (timesheet_id, actor_user_id, event, from_status, to_status, note,
                                           total_seconds, payable_seconds, revision)
      VALUES (s.id, p_actor, 'approved', v_from, s.status, v_note, s.total_seconds, s.payable_seconds, s.revision);

    ELSIF p_action = 'return' THEN
      IF s.status <> 'submitted' THEN
        PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                  jsonb_build_object('reason', 'state', 'timesheet_id', s.id,
                                                     'sheet_status', s.status));
      END IF;
      IF v_note IS NULL THEN
        PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                  jsonb_build_object('reason', 'note_required', 'timesheet_id', s.id));
      END IF;
      UPDATE public.timesheets t
         SET status = 'returned',
             decided_by = p_actor,
             decision_kind = 'manual',
             decision_note = v_note,
             decided_at = now(),
             revision = t.revision + 1
       WHERE t.id = s.id
      RETURNING * INTO s;
      -- Return mirror (D16; M5 deletes this statement): an old-backend per-entry
      -- approval inside a returned sheet must not stay payable after a rollback.
      UPDATE public.time_entries e
         SET status = 'pending'
       WHERE e.timesheet_id = s.id
         AND e.status = 'approved'
         AND e.payout_id IS NULL
         AND e.payable_seconds IS NULL
         AND e.engagement_assignment_id IS NULL;
      INSERT INTO public.timesheet_events (timesheet_id, actor_user_id, event, from_status, to_status, note,
                                           total_seconds, payable_seconds, revision)
      VALUES (s.id, p_actor, 'returned', v_from, s.status, v_note, s.total_seconds, s.payable_seconds, s.revision);

    ELSIF p_action = 'reopen' THEN
      IF s.status <> 'approved' THEN
        PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                  jsonb_build_object('reason', 'state', 'timesheet_id', s.id,
                                                     'sheet_status', s.status));
      END IF;
      IF v_member THEN
        -- Member path: own auto/self sheets only; manual decisions need a request.
        IF s.approver_scope NOT IN ('auto', 'self') THEN
          PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                    jsonb_build_object('reason', 'use_request_reopen', 'timesheet_id', s.id));
        END IF;
      ELSE
        -- Decider path (can_decide_timesheet already passed, so the scope is
        -- team, workspace or hirer).
        IF s.approver_scope NOT IN ('team', 'workspace', 'hirer') THEN
          PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                    jsonb_build_object('reason', 'not_allowed', 'timesheet_id', s.id));
        END IF;
        IF v_note IS NULL THEN
          PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                    jsonb_build_object('reason', 'note_required', 'timesheet_id', s.id));
        END IF;
      END IF;

      -- Settled entries block a reopen: paid (payout or paid outside), billed
      -- (a reservation); the member path also refuses any legacy marker.
      v_settled := CASE
        WHEN EXISTS (SELECT 1 FROM public.time_entries e
                     WHERE e.timesheet_id = s.id
                       AND (e.payout_id IS NOT NULL OR e.legacy_status = 'paid_outside')) THEN 'paid'
        WHEN EXISTS (SELECT 1 FROM public.invoice_time_entries r
                     JOIN public.time_entries e ON e.id = r.entry_id
                     WHERE e.timesheet_id = s.id) THEN 'billed'
        WHEN v_member AND EXISTS (SELECT 1 FROM public.time_entries e
                                  WHERE e.timesheet_id = s.id AND e.legacy_status IS NOT NULL) THEN 'legacy'
      END;
      IF v_settled IS NOT NULL THEN
        PERFORM public.time_raise('TIMESHEET_HAS_SETTLED_ENTRIES',
                                  jsonb_build_object('timesheet_id', s.id, 'reason', v_settled));
      END IF;

      PERFORM public.time_clear_freeze(s.id);
      IF v_member THEN
        UPDATE public.timesheets t
           SET status = 'open',
               approver_scope = NULL,
               policy_snapshot = '{}'::jsonb,
               submitted_at = NULL,
               submitted_by = NULL,
               submission_kind = NULL,
               total_seconds = NULL,
               decided_at = NULL,
               decided_by = NULL,
               decision_kind = NULL,
               decision_note = NULL,
               payable_seconds = NULL,
               overtime_approved = false,
               revision = t.revision + 1
         WHERE t.id = s.id
        RETURNING * INTO s;
      ELSE
        UPDATE public.timesheets t
           SET status = 'returned',
               decided_by = p_actor,
               decision_kind = 'manual',
               decision_note = v_note,
               decided_at = now(),
               payable_seconds = NULL,
               overtime_approved = false,
               revision = t.revision + 1
         WHERE t.id = s.id
        RETURNING * INTO s;
      END IF;
      INSERT INTO public.timesheet_events (timesheet_id, actor_user_id, event, from_status, to_status, note,
                                           total_seconds, payable_seconds, revision)
      VALUES (s.id, p_actor, 'reopened', v_from, s.status, v_note, s.total_seconds, s.payable_seconds, s.revision);

    ELSE -- request_reopen
      IF s.status <> 'approved' THEN
        PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                  jsonb_build_object('reason', 'state', 'timesheet_id', s.id,
                                                     'sheet_status', s.status));
      END IF;
      -- D15: manual and legacy decisions; an auto/self sheet reopens directly.
      IF s.decision_kind IS NULL OR s.decision_kind NOT IN ('manual', 'legacy') THEN
        PERFORM public.time_raise('TIMESHEET_TRANSITION_INVALID',
                                  jsonb_build_object('reason', 'not_allowed', 'timesheet_id', s.id));
      END IF;
      UPDATE public.timesheets t
         SET revision = t.revision + 1
       WHERE t.id = s.id
      RETURNING * INTO s;
      INSERT INTO public.timesheet_events (timesheet_id, actor_user_id, event, from_status, to_status, note,
                                           total_seconds, payable_seconds, revision)
      VALUES (s.id, p_actor, 'reopen_requested', v_from, s.status, v_note,
              s.total_seconds, s.payable_seconds, s.revision);
    END IF;
  END LOOP;

  RETURN QUERY
    SELECT t.* FROM public.timesheets t WHERE t.id = ANY (p_ids) ORDER BY t.id;
END;
$$;
REVOKE ALL ON FUNCTION public.time_timesheet_transition(uuid[], uuid, text, integer[], text, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.time_timesheet_transition(uuid[], uuid, text, integer[], text, boolean, jsonb)
  TO service_role;

-- ── 30. Group A: existing functions rebuilt from their newest body ────────
-- Sources (newest definition by grep over supabase/migrations; md5(prosrc) on
-- prod and dev equals the file body, account_deletion_preflight by its
-- comment-stripped, whitespace-collapsed md5, since the live body is the file
-- without comments):
--   tg_engagement_assignment_running_timer_guard  20260814021000:489-508   7ed2bfa0
--   account_deletion_purge_team                   20260923090200:70-99     851e61fa
--   account_deletion_purge_workspace              20260923090200:128-160   4d0d223b
--   account_deletion_close_running_logs_for_ws    20260923090200:165-178   da5c0ec5 (dropped)
--   delete_account                                20260923090200:211-607   9a5d64ab
--   account_deletion_preflight                    20260923090100:79-282    norm 5948b722
--   reset_qa_fixture                              20260813120000:47-146    5776b01c
-- New: the two open-time predicates, the workspace running-entry closer and
-- time_test_cleanup. Needs 20_engine (time_stop_running_entries,
-- time_timesheet_transition): SQL-language bodies are validated at creation.

-- Open time: a submitted timesheet, or approved team time not yet paid (Owed).
-- Owed counts only where payouts are on (D17): with payouts off nobody records
-- payment in Proyekto, so approved hours would block deletion forever.
CREATE OR REPLACE FUNCTION public.account_deletion_team_has_open_time(p_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.timesheets t
           WHERE t.status = 'submitted' AND t.scope_kind = 'team' AND t.scope_ref = p_team_id)
      OR EXISTS (
           SELECT 1 FROM public.time_entries e
           JOIN public.teams tm ON tm.id = e.team_id AND tm.payouts_enabled
           WHERE e.team_id = p_team_id AND e.context_kind = 'team'
             AND e.payable_seconds IS NOT NULL AND e.legacy_status IS NULL AND e.payout_id IS NULL);
$$;

CREATE OR REPLACE FUNCTION public.account_deletion_workspace_has_open_time(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.timesheets t
           WHERE t.status = 'submitted' AND t.policy_workspace_id = p_workspace_id)
      OR EXISTS (
           SELECT 1 FROM public.time_entries e
           JOIN public.teams tm ON tm.id = e.team_id AND tm.payouts_enabled
           WHERE tm.workspace_id = p_workspace_id AND e.context_kind = 'team'
             AND e.payable_seconds IS NOT NULL AND e.legacy_status IS NULL AND e.payout_id IS NULL);
$$;

-- A5: time_entries.project_id is SET NULL, so an entry outlives its project. A
-- timer still running when its project is destroyed would otherwise keep
-- accruing against nothing. Replaces account_deletion_close_running_logs_for_workspace
-- (dropped below) and, unlike it, folds an in-progress pause.
CREATE OR REPLACE FUNCTION public.account_deletion_close_running_entries_for_workspace(p_workspace_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.time_stop_running_entries(ARRAY(
    SELECT e.id FROM public.time_entries e
    WHERE e.ended_at IS NULL
      AND e.project_id IN (SELECT p.id FROM public.projects p WHERE p.workspace_id = p_workspace_id)));
$$;

-- Integration-harness clean-up (D22): removes one test project's time so the
-- harness's LIFO deletes can run. PostgREST cannot set app.time_maintenance,
-- hence an RPC. Refuses anything that is not a test project.
CREATE OR REPLACE FUNCTION public.time_test_cleanup(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev_maint text := current_setting('app.time_maintenance', true);
  v_members uuid[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id
      AND (p.title LIKE 'itest %' OR p.title LIKE '[QA]%')
  ) THEN
    PERFORM public.time_raise('TIME_TEST_CLEANUP_FORBIDDEN', jsonb_build_object('project_id', p_project_id));
  END IF;

  PERFORM set_config('app.time_maintenance', 'on', true);

  v_members := ARRAY(
    SELECT DISTINCT e.member_user_id FROM public.time_entries e
    WHERE e.project_id = p_project_id AND e.member_user_id IS NOT NULL);

  -- Reservations first: invoice_time_entries.entry_id is RESTRICT.
  DELETE FROM public.invoice_time_entries r
   USING public.time_entries e
   WHERE r.entry_id = e.id AND e.project_id = p_project_id;

  -- Segments and comments cascade.
  DELETE FROM public.time_entries e WHERE e.project_id = p_project_id;

  -- Those members' sheets left empty, in any status (events cascade).
  DELETE FROM public.timesheets t
   WHERE t.member_user_id = ANY (v_members)
     AND NOT EXISTS (SELECT 1 FROM public.time_entries e WHERE e.timesheet_id = t.id);

  PERFORM set_config('app.time_maintenance', coalesce(v_prev_maint, ''), true);
END;
$$;

-- A3 (20260814021000:489-508): ending or cancelling an assignment stops its
-- running timers instead of refusing (L37); the backend sends
-- timer_auto_stopped. BEFORE UPDATE OF status, so the assignment guard on the
-- entries still reads the active row. Never raises.
CREATE OR REPLACE FUNCTION public.tg_engagement_assignment_running_timer_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.status = 'active'
    AND NEW.status IN ('ended', 'cancelled') THEN
    PERFORM public.time_stop_running_entries(
      ARRAY(SELECT e.id FROM public.time_entries e
            WHERE e.engagement_assignment_id = OLD.id AND e.ended_at IS NULL),
      coalesce(NEW.ended_at, now()),
      'stopped_by_assignment_end');
  END IF;
  RETURN NEW;
END;
$$;

-- A8: TEAM_HAS_OPEN_TIME after TEAM_HAS_PAYOUTS.
CREATE OR REPLACE FUNCTION public.account_deletion_purge_team(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- payouts.team_id is CASCADE, so deleting a team would destroy payout
  -- history that payouts.member_user_id (RESTRICT) exists to preserve.
  IF public.account_deletion_team_has_payouts(p_team_id) THEN
    RAISE EXCEPTION 'TEAM_HAS_PAYOUTS';
  END IF;

  -- A submitted timesheet, or approved time not yet paid, is still owed to
  -- someone; deleting the team would erase it.
  IF public.account_deletion_team_has_open_time(p_team_id) THEN
    PERFORM public.time_raise('TEAM_HAS_OPEN_TIME', jsonb_build_object('team_id', p_team_id));
  END IF;

  -- qa_fixtures.primary_team_id / secondary_team_id are RESTRICT and would
  -- fail as a bare FK error; name it instead.
  IF EXISTS (SELECT 1 FROM public.qa_fixtures q
             WHERE q.primary_team_id = p_team_id OR q.secondary_team_id = p_team_id) THEN
    RAISE EXCEPTION 'TEAM_HAS_QA_FIXTURE';
  END IF;

  -- projects.primary_team_id is NO ACTION; project_teams.team_id is RESTRICT
  -- (a team here may be attached to a project in ANOTHER workspace).
  UPDATE public.projects SET primary_team_id = NULL WHERE primary_team_id = p_team_id;
  DELETE FROM public.project_teams WHERE team_id = p_team_id;

  -- team_members cascades; tg_team_members_block_owner_delete stands down
  -- because the team row is gone by the time it fires.
  DELETE FROM public.teams WHERE id = p_team_id;
END;
$$;

-- A9: WORKSPACE_HAS_OPEN_TIME after WORKSPACE_HAS_PAYOUTS; running entries are
-- closed by the _entries_ helper.
CREATE OR REPLACE FUNCTION public.account_deletion_purge_workspace(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_team record;
BEGIN
  IF public.account_deletion_workspace_is_paid(p_workspace_id) THEN
    RAISE EXCEPTION 'WORKSPACE_HAS_ACTIVE_SUBSCRIPTION';
  END IF;
  IF public.account_deletion_workspace_has_payouts(p_workspace_id) THEN
    RAISE EXCEPTION 'WORKSPACE_HAS_PAYOUTS';
  END IF;
  IF public.account_deletion_workspace_has_open_time(p_workspace_id) THEN
    PERFORM public.time_raise('WORKSPACE_HAS_OPEN_TIME', jsonb_build_object('workspace_id', p_workspace_id));
  END IF;

  -- "Delete the workspace with everything in it" is NOT what DELETE FROM
  -- workspaces does: projects.workspace_id and teams.workspace_id are SET NULL,
  -- so the plain delete orphans the work instead of destroying it. Contents go
  -- explicitly, projects first (that clears primary_team_id and project_teams
  -- by cascade, which teams then need).
  PERFORM public.account_deletion_close_running_entries_for_workspace(p_workspace_id);
  DELETE FROM public.projects WHERE workspace_id = p_workspace_id;

  FOR v_team IN SELECT id FROM public.teams WHERE workspace_id = p_workspace_id LOOP
    PERFORM public.account_deletion_purge_team(v_team.id);
  END LOOP;

  -- Cascades workspace_members, workspace_invites, workspace_subscriptions,
  -- workspace_slug_history and roadmap_ai_sessions.
  DELETE FROM public.workspaces WHERE id = p_workspace_id;
END;
$$;

-- A5: nothing calls it any more (late binding: dropped after A9 is rebuilt).
DROP FUNCTION public.account_deletion_close_running_logs_for_workspace(uuid);

-- A10: both open-time refusals reported before deletion. Decisions gain
-- has_open_time (and can_delete folds it in); blockers list the containers
-- that would be destroyed with no choice to make while time on them is open;
-- those teams leave will_be_deleted.teams. preflight_token still covers the
-- decisions only.
CREATE OR REPLACE FUNCTION public.account_deletion_preflight(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile   public.profiles%ROWTYPE;
  v_decisions jsonb;
  v_deleted   jsonb;
  v_transfer  jsonb;
  v_kept      jsonb;
  v_auth      jsonb;
  v_admin_warn boolean;
  v_blockers  jsonb;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND';
  END IF;
  IF COALESCE(v_profile.is_guest, false) THEN
    -- Guest sessions expire on their own; there is no account to close.
    RAISE EXCEPTION 'ACCOUNT_IS_GUEST';
  END IF;
  IF v_profile.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'ACCOUNT_ALREADY_DELETED';
  END IF;

  -- ---- Containers needing a decision --------------------------------------
  -- "Sole-owned with other members": the user is an owner, they are the ONLY
  -- owner, and somebody else is still in it. workspaces has no owner column -
  -- workspace_members.role is the only source, the same rule assertNotLastOwner
  -- uses.
  WITH sole AS (
    SELECT w.id, w.name, w.slug,
           (SELECT count(*) FROM public.workspace_members m WHERE m.workspace_id = w.id) AS member_count
    FROM public.workspaces w
    JOIN public.workspace_members me
      ON me.workspace_id = w.id AND me.user_id = p_user_id AND me.role = 'owner'
    WHERE (SELECT count(*) FROM public.workspace_members o
             WHERE o.workspace_id = w.id AND o.role = 'owner') = 1
  ),
  ws AS (
    SELECT s.*,
           NOT (public.account_deletion_workspace_is_paid(s.id)
                OR public.account_deletion_workspace_has_payouts(s.id)
                OR public.account_deletion_workspace_has_open_time(s.id)) AS can_delete,
           public.account_deletion_workspace_is_paid(s.id) AS is_paid,
           public.account_deletion_workspace_has_open_time(s.id) AS has_open_time
    FROM sole s WHERE s.member_count > 1
  ),
  tm AS (
    SELECT t.id, t.name, t.workspace_id,
           (SELECT count(*) FROM public.team_members m WHERE m.team_id = t.id) AS member_count,
           NOT (public.account_deletion_team_has_payouts(t.id)
                OR public.account_deletion_team_has_open_time(t.id)) AS can_delete,
           public.account_deletion_team_has_open_time(t.id) AS has_open_time
    FROM public.teams t
    WHERE t.owner_id = p_user_id
      AND COALESCE(t.is_personal, false) = false
      AND (SELECT count(*) FROM public.team_members m WHERE m.team_id = t.id) > 1
  )
  SELECT COALESCE(jsonb_agg(d ORDER BY d->>'kind', d->>'name'), '[]'::jsonb) INTO v_decisions
  FROM (
    SELECT jsonb_build_object(
      'kind','workspace','id',ws.id,'name',ws.name,'slug',ws.slug,
      'member_count',ws.member_count,'can_delete',ws.can_delete,'is_paid',ws.is_paid,
      'has_open_time',ws.has_open_time,
      'project_count',(SELECT count(*) FROM public.projects p WHERE p.workspace_id = ws.id),
      'team_count',(SELECT count(*) FROM public.teams t WHERE t.workspace_id = ws.id),
      'candidates',(
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'user_id',pr.id,'display_name',pr.display_name,'email',pr.email,
          'avatar_url',pr.avatar_url,'role',m.role,'joined_at',m.joined_at)
          ORDER BY CASE m.role WHEN 'admin' THEN 0 ELSE 1 END, m.joined_at), '[]'::jsonb)
        FROM public.workspace_members m
        JOIN public.profiles pr ON pr.id = m.user_id
        WHERE m.workspace_id = ws.id AND m.user_id <> p_user_id AND pr.deleted_at IS NULL)
    ) AS d FROM ws
    UNION ALL
    SELECT jsonb_build_object(
      'kind','team','id',tm.id,'name',tm.name,'workspace_id',tm.workspace_id,
      'member_count',tm.member_count,'can_delete',tm.can_delete,'is_paid',false,
      'has_open_time',tm.has_open_time,
      'candidates',(
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'user_id',pr.id,'display_name',pr.display_name,'email',pr.email,
          'avatar_url',pr.avatar_url,'role',m.role,'joined_at',m.joined_at)
          ORDER BY CASE m.role WHEN 'admin' THEN 0 ELSE 1 END, m.joined_at), '[]'::jsonb)
        FROM public.team_members m
        JOIN public.profiles pr ON pr.id = m.user_id
        WHERE m.team_id = tm.id AND m.user_id <> p_user_id AND pr.deleted_at IS NULL)
    ) AS d FROM tm
  ) d_rows;

  -- ---- Blockers --------------------------------------------------------------
  -- Containers the deletion would destroy with no choice to make (sole-member
  -- workspaces; owned teams with no payouts that are personal or have nobody
  -- else in them) while time on them is still open: a submitted timesheet, or
  -- approved time not yet paid. Temporary by nature: it clears once the time
  -- is decided and paid. delete_account refuses with the first code.
  SELECT COALESCE(jsonb_agg(b ORDER BY b->>'kind' DESC, b->>'name'), '[]'::jsonb) INTO v_blockers
  FROM (
    SELECT jsonb_build_object('kind','workspace','id',w.id,'name',w.name,
                              'code','WORKSPACE_HAS_OPEN_TIME') AS b
    FROM public.workspaces w
    JOIN public.workspace_members me ON me.workspace_id = w.id AND me.user_id = p_user_id AND me.role='owner'
    WHERE (SELECT count(*) FROM public.workspace_members m WHERE m.workspace_id = w.id) = 1
      AND public.account_deletion_workspace_has_open_time(w.id)
    UNION ALL
    SELECT jsonb_build_object('kind','team','id',t.id,'name',t.name,
                              'code','TEAM_HAS_OPEN_TIME') AS b
    FROM public.teams t
    WHERE t.owner_id = p_user_id
      AND NOT public.account_deletion_team_has_payouts(t.id)
      AND (COALESCE(t.is_personal, false)
           OR (SELECT count(*) FROM public.team_members m WHERE m.team_id = t.id) <= 1)
      AND public.account_deletion_team_has_open_time(t.id)
  ) b_rows;

  -- ---- Deleted outright ----------------------------------------------------
  -- Containers only this person is in, and projects nobody else can open. A
  -- project with no other project_access row is private by definition, which is
  -- why it goes rather than being handed to a stranger.
  SELECT jsonb_build_object(
    'workspaces', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'slug',w.slug))
      FROM public.workspaces w
      JOIN public.workspace_members me ON me.workspace_id = w.id AND me.user_id = p_user_id AND me.role='owner'
      WHERE (SELECT count(*) FROM public.workspace_members m WHERE m.workspace_id = w.id) = 1), '[]'::jsonb),
    'teams', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name))
      FROM public.teams t
      WHERE t.owner_id = p_user_id
        AND NOT public.account_deletion_team_has_payouts(t.id)
        -- A personal team goes whatever its membership looks like; a shared one
        -- only when nobody else is in it (otherwise it is a decision above).
        AND (COALESCE(t.is_personal, false)
             OR (SELECT count(*) FROM public.team_members m WHERE m.team_id = t.id) <= 1)
        -- A team with open time is a blocker instead (above).
        AND NOT public.account_deletion_team_has_open_time(t.id)), '[]'::jsonb),
    'projects', (
      SELECT count(*) FROM public.projects p
      WHERE p.owner_id = p_user_id
        AND NOT EXISTS (SELECT 1 FROM public.project_access a
                        WHERE a.project_id = p.id AND a.user_id <> p_user_id)),
    'standalone_roadmaps', (
      SELECT count(*) FROM public.roadmaps r
      WHERE r.owner_id = p_user_id AND r.project_id IS NULL),
    'devices', (SELECT count(*) FROM public.device_tokens d WHERE d.user_id = p_user_id),
    'api_tokens', (SELECT count(*) FROM public.mcp_personal_access_tokens t WHERE t.user_id = p_user_id),
    'identity_documents', (SELECT count(*) FROM public.user_identity_documents u WHERE u.user_id = p_user_id)
  ) INTO v_deleted;

  -- ---- Handed to someone else ---------------------------------------------
  -- A project with other members goes to one of ITS OWN members, never to the
  -- workspace owner: every permission helper and RLS policy reads project_access
  -- and never projects.owner_id (see 20260901154357), so granting a
  -- non-member owner access would hand a stranger a private project.
  SELECT jsonb_build_object(
    'projects', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',p.id,'title',p.title))
      FROM public.projects p
      WHERE p.owner_id = p_user_id
        AND EXISTS (SELECT 1 FROM public.project_access a
                    WHERE a.project_id = p.id AND a.user_id <> p_user_id)), '[]'::jsonb),
    'workspaces_left', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'slug',w.slug))
      FROM public.workspaces w
      JOIN public.workspace_members me ON me.workspace_id = w.id AND me.user_id = p_user_id
      WHERE me.role <> 'owner'
         OR (SELECT count(*) FROM public.workspace_members o
             WHERE o.workspace_id = w.id AND o.role='owner') > 1), '[]'::jsonb),
    'teams_left', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name))
      FROM public.teams t
      JOIN public.team_members m ON m.team_id = t.id AND m.user_id = p_user_id
      WHERE t.owner_id <> p_user_id), '[]'::jsonb)
  ) INTO v_transfer;

  -- ---- Kept, as "Deleted user" --------------------------------------------
  SELECT jsonb_build_object(
    'attribution', 'Deleted user',
    -- Teams carrying payout history with nobody left to hand them to. They are
    -- archived under the tombstone rather than deleted, because deleting a team
    -- CASCADEs its payouts away (see account_deletion_team_has_payouts).
    'archived_teams', (
      SELECT count(*) FROM public.teams t
      WHERE t.owner_id = p_user_id
        AND public.account_deletion_team_has_payouts(t.id)
        AND (SELECT count(*) FROM public.team_members m WHERE m.team_id = t.id) <= 1),
    'chat_messages', (SELECT count(*) FROM public.chat_room_messages m WHERE m.sender_id = p_user_id AND m.deleted_at IS NULL),
    'comments', (SELECT (SELECT count(*) FROM public.task_comments c WHERE c.author_id = p_user_id)
                      + (SELECT count(*) FROM public.epic_comments c WHERE c.user_id = p_user_id)
                      + (SELECT count(*) FROM public.feature_comments c WHERE c.user_id = p_user_id)),
    'decisions', (SELECT count(*) FROM public.project_decisions d WHERE d.created_by = p_user_id),
    'deliverables', (SELECT count(*) FROM public.project_deliverables d WHERE d.created_by = p_user_id),
    'change_requests', (SELECT count(*) FROM public.project_change_requests r WHERE r.requested_by = p_user_id),
    'risks', (SELECT count(*) FROM public.project_risk_register r WHERE r.created_by = p_user_id),
    'activity_entries', (SELECT count(*) FROM public.project_activity_log l WHERE l.actor_id = p_user_id),
    'contracts', (SELECT count(*) FROM public.contracts c WHERE c.client_user_id = p_user_id OR c.consultant_user_id = p_user_id),
    'invoices', (SELECT count(*) FROM public.invoices i WHERE i.issuer_user_id = p_user_id OR i.recipient_user_id = p_user_id),
    'payouts', (SELECT count(*) FROM public.payouts p WHERE p.member_user_id = p_user_id OR p.created_by = p_user_id)
  ) INTO v_kept;

  -- ---- Which re-auth control the client should render ----------------------
  -- Told by the server, not sniffed client-side: a Google-only account has an
  -- empty encrypted_password and no password to check.
  SELECT jsonb_build_object(
    'has_password', COALESCE((SELECT u.encrypted_password IS NOT NULL AND u.encrypted_password <> ''
                              FROM auth.users u WHERE u.id = p_user_id), false),
    'providers', COALESCE((SELECT jsonb_agg(DISTINCT i.provider)
                           FROM auth.identities i WHERE i.user_id = p_user_id), '[]'::jsonb)
  ) INTO v_auth;

  -- A warning, never a refusal: locking yourself out of your own admin console
  -- is your call to make, and refusing would breach the Play requirement.
  SELECT EXISTS (SELECT 1 FROM public.admin_profiles a WHERE a.user_id = p_user_id AND a.is_active)
     AND (SELECT count(*) FROM public.admin_profiles a WHERE a.is_active) = 1
    INTO v_admin_warn;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'generated_at', now(),
    'decisions', v_decisions,
    'blockers', v_blockers,
    'will_be_deleted', v_deleted,
    'will_transfer', v_transfer,
    'will_be_kept', v_kept,
    'auth', v_auth,
    'warnings', CASE WHEN v_admin_warn THEN '["LAST_PLATFORM_ADMIN"]'::jsonb ELSE '[]'::jsonb END,
    -- Lets the writer detect "your plan is stale" as distinct from "something
    -- broke". Covers only the decision set, because that is the only part the
    -- user acts on.
    'preflight_token', md5(v_decisions::text)
  );
END;
$$;

-- A6: refuses on the first preflight blocker; running entries stop through
-- time_stop_running_entries; step 5b settles the user's own time (stop, drop
-- empty open sheets, submit the rest on deletion); step 7 removes time
-- preferences and remembered "For" choices; the "Deleted user" snapshot also
-- goes onto timesheets.
CREATE OR REPLACE FUNCTION public.delete_account(
  p_user_id uuid,
  p_resolution jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile      public.profiles%ROWTYPE;
  v_pre          jsonb;
  v_decisions    jsonb;
  v_decision     jsonb;
  v_choice       jsonb;
  v_id           uuid;
  v_action       text;
  v_nominee      uuid;
  v_rec          record;
  v_successor    uuid;
  v_new_email    text;
  v_rows         integer;
  v_transferred_projects int := 0;
  v_deleted_projects     int := 0;
  v_purged_workspaces    int := 0;
  v_purged_teams         int := 0;
  v_archived_teams       int := 0;
  v_storage_keys jsonb;
  v_sheet_ids    uuid[];
BEGIN
  -- ---- 1. Serialise -------------------------------------------------------
  -- Seed 2. Seed 0 is provision_personal_project AND the consultant_subcategories
  -- trigger; seed 1 is provision_default_workspace AND the marketplace_topics
  -- trigger. This also serialises against a workspace being provisioned by
  -- completeOnboarding in another request.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 2));

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND'; END IF;
  IF COALESCE(v_profile.is_guest, false) THEN RAISE EXCEPTION 'ACCOUNT_IS_GUEST'; END IF;
  -- Idempotent: a retry after a dropped connection must not look like a failure.
  IF v_profile.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'ACCOUNT_ALREADY_DELETED'; END IF;

  -- ---- 2. Recompute the decision set INSIDE the lock ----------------------
  -- Never trust the preflight the client saw. "The last other member left
  -- between preflight and commit" is a real race a preflight check cannot
  -- survive.
  v_pre := public.account_deletion_preflight(p_user_id);
  -- Open time on a container that would be destroyed with no choice to make
  -- (a submitted timesheet, or approved time not yet paid): refuse with the
  -- first blocker's code.
  IF jsonb_array_length(COALESCE(v_pre -> 'blockers', '[]'::jsonb)) > 0 THEN
    PERFORM public.time_raise(v_pre -> 'blockers' -> 0 ->> 'code', v_pre -> 'blockers' -> 0);
  END IF;
  v_decisions := v_pre -> 'decisions';

  FOR v_decision IN SELECT * FROM jsonb_array_elements(v_decisions) LOOP
    v_id := (v_decision ->> 'id')::uuid;
    SELECT c.value INTO v_choice
      FROM jsonb_array_elements(COALESCE(p_resolution -> 'containers', '[]'::jsonb)) c
     WHERE (c.value ->> 'id')::uuid = v_id
       AND (c.value ->> 'kind') = (v_decision ->> 'kind')
     LIMIT 1;

    IF v_choice IS NULL THEN
      RAISE EXCEPTION 'RESOLUTION_INCOMPLETE';
    END IF;

    v_action := v_choice ->> 'action';
    IF v_action NOT IN ('transfer', 'delete') THEN
      RAISE EXCEPTION 'RESOLUTION_INCOMPLETE';
    END IF;
    IF v_action = 'delete' AND NOT (v_decision ->> 'can_delete')::boolean THEN
      RAISE EXCEPTION 'CONTAINER_NOT_DELETABLE';
    END IF;
  END LOOP;

  -- Anything named that is not a live decision means the client is working from
  -- a stale plan.
  FOR v_choice IN
    SELECT c.value FROM jsonb_array_elements(COALESCE(p_resolution -> 'containers', '[]'::jsonb)) c
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_decisions) d
      WHERE (d.value ->> 'id') = (v_choice ->> 'id')
        AND (d.value ->> 'kind') = (v_choice ->> 'kind')
    ) THEN
      RAISE EXCEPTION 'RESOLUTION_UNKNOWN_CONTAINER';
    END IF;
  END LOOP;

  -- ---- 3. Workspaces ------------------------------------------------------
  FOR v_decision IN
    SELECT d.value FROM jsonb_array_elements(v_decisions) d WHERE d.value ->> 'kind' = 'workspace'
  LOOP
    v_id := (v_decision ->> 'id')::uuid;
    SELECT c.value INTO v_choice
      FROM jsonb_array_elements(p_resolution -> 'containers') c
     WHERE (c.value ->> 'id')::uuid = v_id AND (c.value ->> 'kind') = 'workspace' LIMIT 1;

    -- Step 2 already guarantees a choice exists. Re-assert it anyway: with a
    -- NULL v_choice the comparison below is NULL and control would fall to
    -- ELSE, i.e. purge. Destroying a workspace must never be the default branch.
    IF v_choice IS NULL THEN RAISE EXCEPTION 'RESOLUTION_INCOMPLETE'; END IF;

    IF (v_choice ->> 'action') = 'transfer' THEN
      v_nominee := (v_choice ->> 'new_owner_id')::uuid;
      PERFORM public.account_deletion_transfer_workspace(p_user_id, v_id, v_nominee);
    ELSE
      PERFORM public.account_deletion_purge_workspace(v_id);
      v_purged_workspaces := v_purged_workspaces + 1;
    END IF;
  END LOOP;

  -- Sole-owned with nobody else in them: no decision to make, they just go.
  FOR v_rec IN
    SELECT w.id FROM public.workspaces w
    JOIN public.workspace_members me
      ON me.workspace_id = w.id AND me.user_id = p_user_id AND me.role = 'owner'
    WHERE (SELECT count(*) FROM public.workspace_members m WHERE m.workspace_id = w.id) = 1
  LOOP
    PERFORM public.account_deletion_purge_workspace(v_rec.id);
    v_purged_workspaces := v_purged_workspaces + 1;
  END LOOP;

  -- ---- 4. Teams -----------------------------------------------------------
  -- Re-queried from live rows: teams inside a workspace purged above are gone.
  FOR v_decision IN
    SELECT d.value FROM jsonb_array_elements(v_decisions) d WHERE d.value ->> 'kind' = 'team'
  LOOP
    v_id := (v_decision ->> 'id')::uuid;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.teams WHERE id = v_id);

    SELECT c.value INTO v_choice
      FROM jsonb_array_elements(p_resolution -> 'containers') c
     WHERE (c.value ->> 'id')::uuid = v_id AND (c.value ->> 'kind') = 'team' LIMIT 1;

    -- Same reasoning as the workspace loop: never purge by falling through.
    IF v_choice IS NULL THEN RAISE EXCEPTION 'RESOLUTION_INCOMPLETE'; END IF;

    IF (v_choice ->> 'action') = 'transfer' THEN
      v_nominee := (v_choice ->> 'new_owner_id')::uuid;
      PERFORM public.account_deletion_transfer_team(p_user_id, v_id, v_nominee);
    ELSE
      PERFORM public.account_deletion_purge_team(v_id);
      v_purged_teams := v_purged_teams + 1;
    END IF;
  END LOOP;

  FOR v_rec IN SELECT t.id FROM public.teams t WHERE t.owner_id = p_user_id LOOP
    IF public.account_deletion_team_has_payouts(v_rec.id) THEN
      -- Nobody to hand it to and its payout history must survive: archive it
      -- under the tombstone rather than destroy financial records.
      UPDATE public.teams SET status = 'archived' WHERE id = v_rec.id;
      v_archived_teams := v_archived_teams + 1;
    ELSE
      PERFORM public.account_deletion_purge_team(v_rec.id);
      v_purged_teams := v_purged_teams + 1;
    END IF;
  END LOOP;

  -- ---- 5. Projects --------------------------------------------------------
  FOR v_rec IN SELECT p.id FROM public.projects p WHERE p.owner_id = p_user_id LOOP
    v_successor := public.account_deletion_project_successor(v_rec.id, p_user_id);

    IF v_successor IS NULL THEN
      -- Nobody else can open it, so it is private by definition.
      PERFORM public.time_stop_running_entries(ARRAY(
        SELECT e.id FROM public.time_entries e
        WHERE e.project_id = v_rec.id AND e.ended_at IS NULL));

      DELETE FROM public.projects WHERE id = v_rec.id;
      v_deleted_projects := v_deleted_projects + 1;
    ELSE
      UPDATE public.projects SET owner_id = v_successor WHERE id = v_rec.id;

      -- has_direct_grant = true is mandatory: tg_project_team_members_sync_shares
      -- garbage-collects any project_access row without it once team curation
      -- goes away (20260901154357), so a flag-false row would be one team
      -- detach from deletion.
      -- origin is NOT NULL with no default; 'direct' is the value the codebase
      -- uses for a grant that is not derived from team curation. On conflict
      -- the existing origin is left alone - only the role and the flag move.
      INSERT INTO public.project_access (project_id, user_id, role, origin, has_direct_grant, granted_by, granted_at)
      VALUES (v_rec.id, v_successor, 'owner', 'direct', true, v_successor, now())
      ON CONFLICT (project_id, user_id)
      DO UPDATE SET role = 'owner', has_direct_grant = true;

      UPDATE public.roadmaps SET owner_id = v_successor
        WHERE project_id = v_rec.id AND owner_id = p_user_id;
      UPDATE public.finance_books SET owner_user_id = v_successor
        WHERE project_id = v_rec.id AND owner_user_id = p_user_id;

      v_transferred_projects := v_transferred_projects + 1;
    END IF;
  END LOOP;

  -- Roadmaps with no project are personal scratch space.
  DELETE FROM public.roadmaps WHERE owner_id = p_user_id AND project_id IS NULL;

  -- ---- 5b. Time -------------------------------------------------------------
  -- After the purges: sheets submitted before them would count as open time
  -- and block the purge of the user's own containers.
  -- (a) Stop the user's running timers: submit refuses a running entry, and a
  -- timer on a transferred project would otherwise run forever.
  PERFORM public.time_stop_running_entries(ARRAY(
    SELECT e.id FROM public.time_entries e
    WHERE e.member_user_id = p_user_id AND e.ended_at IS NULL));

  -- (b) An open sheet with no entries has nothing to approve.
  DELETE FROM public.timesheets t
   WHERE t.member_user_id = p_user_id AND t.status = 'open'
     AND NOT EXISTS (SELECT 1 FROM public.time_entries e WHERE e.timesheet_id = t.id);

  -- (c) Every other open or returned sheet goes to its deciders
  -- (submission_kind 'on_deletion', no actor). An empty returned sheet is left.
  v_sheet_ids := ARRAY(
    SELECT t.id FROM public.timesheets t
    WHERE t.member_user_id = p_user_id AND t.status IN ('open', 'returned')
      AND EXISTS (SELECT 1 FROM public.time_entries e WHERE e.timesheet_id = t.id)
    ORDER BY t.id);
  IF cardinality(v_sheet_ids) > 0 THEN
    PERFORM * FROM public.time_timesheet_transition(v_sheet_ids, NULL, 'submit_on_deletion', NULL);
  END IF;

  -- ---- 6. Collect the object-store keys BEFORE the rows go ---------------
  SELECT jsonb_build_object(
    'avatar_url', v_profile.avatar_url,
    'banner_url', v_profile.banner_url,
    'portfolio', COALESCE((SELECT jsonb_agg(u.image_url) FROM public.user_portfolios u
                           WHERE u.user_id = p_user_id AND u.image_url IS NOT NULL), '[]'::jsonb),
    'identity_documents', COALESCE((SELECT jsonb_agg(d.storage_path) FROM public.user_identity_documents d
                                    WHERE d.user_id = p_user_id AND d.storage_path IS NOT NULL), '[]'::jsonb)
  ) INTO v_storage_keys;

  -- ---- 7. Personal rows ---------------------------------------------------
  DELETE FROM public.workspace_members       WHERE user_id = p_user_id;
  DELETE FROM public.team_members            WHERE user_id = p_user_id;
  DELETE FROM public.project_team_members    WHERE user_id = p_user_id;
  DELETE FROM public.project_access          WHERE user_id = p_user_id;
  DELETE FROM public.chat_room_participants  WHERE user_id = p_user_id;
  DELETE FROM public.chat_room_stars         WHERE user_id = p_user_id;
  DELETE FROM public.chat_room_notification_prefs WHERE user_id = p_user_id;
  DELETE FROM public.meeting_participants    WHERE user_id = p_user_id;
  DELETE FROM public.deliverable_reviewers   WHERE reviewer_id = p_user_id;
  DELETE FROM public.roadmap_task_assignees  WHERE assignee_id = p_user_id;
  DELETE FROM public.roadmap_feature_assignees WHERE assignee_id = p_user_id;
  DELETE FROM public.finance_book_members    WHERE user_id = p_user_id;
  DELETE FROM public.finance_member_allocations WHERE user_id = p_user_id;
  -- Under the tombstone no profile delete ever cascades to these.
  DELETE FROM public.user_time_preferences   WHERE user_id = p_user_id;
  DELETE FROM public.time_logging_defaults   WHERE user_id = p_user_id;

  DELETE FROM public.project_invites         WHERE invitee_id = p_user_id OR invited_by = p_user_id;
  DELETE FROM public.workspace_invites       WHERE invitee_id = p_user_id OR invited_by = p_user_id;
  DELETE FROM public.team_invites            WHERE invitee_id = p_user_id OR invited_by = p_user_id;
  DELETE FROM public.project_team_invites    WHERE invitee_id = p_user_id OR invited_by = p_user_id;
  -- pending_mention_invites matches on invitee_email with no invitee_id guard
  -- and no freshness window, so revoke rather than rely on that.
  UPDATE public.pending_mention_invites SET status = 'revoked'
    WHERE invited_by = p_user_id AND status = 'pending';
  UPDATE public.pending_mention_invites SET status = 'revoked'
    WHERE lower(invitee_email) = lower(COALESCE(v_profile.email, '')) AND status = 'pending';

  DELETE FROM public.notifications           WHERE user_id = p_user_id;
  DELETE FROM public.notification_preferences WHERE user_id = p_user_id;
  DELETE FROM public.notification_email_settings WHERE user_id = p_user_id;
  -- resolveRecipient prefers the frozen to_email, so a queued row would be
  -- delivered to the real address after deletion.
  DELETE FROM public.notification_email_outbox WHERE user_id = p_user_id;

  DELETE FROM public.device_tokens           WHERE user_id = p_user_id;
  DELETE FROM public.mcp_personal_access_tokens WHERE user_id = p_user_id;
  DELETE FROM public.mcp_oauth_grants        WHERE user_id = p_user_id;
  DELETE FROM public.google_calendar_connections WHERE user_id = p_user_id;
  DELETE FROM public.payout_methods          WHERE user_id = p_user_id;
  DELETE FROM public.wallets                 WHERE user_id = p_user_id;

  DELETE FROM public.user_certifications     WHERE user_id = p_user_id;
  DELETE FROM public.user_educations         WHERE user_id = p_user_id;
  DELETE FROM public.user_experiences        WHERE user_id = p_user_id;
  DELETE FROM public.user_languages          WHERE user_id = p_user_id;
  DELETE FROM public.user_licenses           WHERE user_id = p_user_id;
  DELETE FROM public.user_portfolios         WHERE user_id = p_user_id;
  DELETE FROM public.user_rate_settings      WHERE user_id = p_user_id;
  DELETE FROM public.user_skills             WHERE user_id = p_user_id;
  DELETE FROM public.user_specializations    WHERE user_id = p_user_id;
  DELETE FROM public.user_stats              WHERE user_id = p_user_id;
  DELETE FROM public.user_tour_progress      WHERE user_id = p_user_id;
  DELETE FROM public.user_verifications      WHERE user_id = p_user_id;
  DELETE FROM public.user_identity_documents WHERE user_id = p_user_id;

  DELETE FROM public.consultant_applications WHERE user_id = p_user_id;
  DELETE FROM public.consultant_subcategories WHERE user_id = p_user_id;
  DELETE FROM public.consultant_topics       WHERE user_id = p_user_id;
  DELETE FROM public.marketplace_survey_responses WHERE user_id = p_user_id;
  DELETE FROM public.marketplace_survey_categories WHERE user_id = p_user_id;
  DELETE FROM public.admin_profiles          WHERE user_id = p_user_id;
  DELETE FROM public.personal_projects       WHERE user_id = p_user_id;

  -- password_resets has NO FK at all, so nothing would ever clean it, and an
  -- outstanding code would otherwise set a working password on the tombstone
  -- (confirmPasswordReset reads user_id and never re-checks the account).
  DELETE FROM public.password_resets         WHERE user_id = p_user_id;
  IF v_profile.email IS NOT NULL THEN
    DELETE FROM public.password_resets       WHERE lower(email) = lower(v_profile.email);
    DELETE FROM public.email_verification_codes WHERE lower(email) = lower(v_profile.email);
  END IF;
  DELETE FROM public.account_deletion_challenges WHERE user_id = p_user_id;

  -- ---- 8. Retained privilege and public presence --------------------------
  -- Nothing is deleted, so is_admin() and is_active_consultant() would keep
  -- returning true. consultant_profiles/talent_profiles are RESTRICT-bound and
  -- cannot be deleted, so status is the only available lever.
  UPDATE public.consultant_profiles SET status = 'revoked'  WHERE user_id = p_user_id;
  UPDATE public.talent_profiles     SET status = 'paused'   WHERE user_id = p_user_id;
  UPDATE public.service_offerings   SET status = 'archived' WHERE user_id = p_user_id;
  UPDATE public.project_postings    SET status = 'closed'   WHERE author_id = p_user_id;
  DELETE FROM public.project_posting_proposals
    WHERE consultant_id = p_user_id AND status NOT IN ('accepted', 'declined', 'withdrawn');
  -- roadmap_shares carry a share_token: live bearer credentials this user
  -- minted. Deactivate rather than delete so history still resolves.
  UPDATE public.roadmap_shares SET is_active = false WHERE created_by = p_user_id;

  -- Retained snapshots that a profiles scrub never reaches.
  UPDATE public.time_entries SET member_display_name_snapshot = 'Deleted user'
    WHERE member_user_id = p_user_id AND member_display_name_snapshot IS NOT NULL;
  UPDATE public.timesheets SET member_display_name_snapshot = 'Deleted user'
    WHERE member_user_id = p_user_id;

  -- ---- 9. Scrub the profile ----------------------------------------------
  -- The email is rotated, not nulled: profiles_email_required_for_non_guests
  -- forbids NULL for a non-guest, and setting is_guest instead would arm the
  -- guest auth header AND cleanup_old_guest_users. Lowercase because
  -- profiles_email_key is a plain UNIQUE while every lookup uses ilike, and
  -- not derived from the old address because a hash of an email is still
  -- personal data.
  v_new_email := 'deleted+' || replace(p_user_id::text, '-', '') || '@deleted.invalid';

  UPDATE public.profiles SET
    email                  = v_new_email,
    display_name           = 'Deleted user',
    first_name             = 'Deleted',
    last_name              = 'user',
    avatar_url             = NULL,
    banner_url             = NULL,
    bio                    = NULL,
    headline               = NULL,
    gender                 = NULL,
    phone_number           = NULL,
    country                = NULL,
    city                   = NULL,
    zip_code               = NULL,
    date_of_birth          = NULL,
    migrated_from_guest_id = NULL,
    settings               = '{}'::jsonb,
    tutorials_completed    = '{}'::jsonb,
    is_email_verified      = false,
    deleted_at             = now(),
    updated_at             = now()
  WHERE id = p_user_id;

  -- ---- 10. Scrub the auth row --------------------------------------------
  -- There is no admin API to delete an identity (unlinkIdentity is user-scoped
  -- and refuses the last one), and GoTrue resolves an OIDC login through
  -- auth.identities (provider, provider_id) - so rotating the email alone would
  -- leave the account resurrectable by tapping "Sign in with Google".
  --
  -- banned_until is a finite far-future date, not 'infinity': GoTrue scans that
  -- column into a Go time.Time and infinity is a Postgres-only value.
  UPDATE auth.users SET
    email                      = v_new_email,
    phone                      = NULL,
    encrypted_password         = '',
    email_change               = '',
    phone_change               = '',
    confirmation_token         = '',
    recovery_token             = '',
    email_change_token_new     = '',
    email_change_token_current = '',
    reauthentication_token     = '',
    email_confirmed_at         = NULL,
    phone_confirmed_at         = NULL,
    raw_user_meta_data         = '{}'::jsonb,
    raw_app_meta_data          = jsonb_build_object('provider', 'deleted', 'providers', '[]'::jsonb),
    banned_until               = now() + interval '100 years',
    updated_at                 = now()
  WHERE id = p_user_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  -- Not decoration. If this function is ever owned by a role without bypassrls
  -- the UPDATE silently matches zero rows and the account stays fully usable
  -- while the API returns 200. Fail loudly and roll the whole thing back.
  IF v_rows <> 1 THEN RAISE EXCEPTION 'AUTH_SCRUB_FAILED'; END IF;

  DELETE FROM auth.identities           WHERE user_id = p_user_id;
  DELETE FROM auth.sessions             WHERE user_id = p_user_id;
  DELETE FROM auth.refresh_tokens       WHERE user_id = p_user_id::text;
  DELETE FROM auth.mfa_factors          WHERE user_id = p_user_id;
  DELETE FROM auth.mfa_recovery_code_sets WHERE user_id = p_user_id;
  DELETE FROM auth.one_time_tokens      WHERE user_id = p_user_id;
  DELETE FROM auth.flow_state           WHERE user_id = p_user_id;
  DELETE FROM auth.oauth_consents       WHERE user_id = p_user_id;
  DELETE FROM auth.oauth_authorizations WHERE user_id = p_user_id;
  DELETE FROM auth.webauthn_credentials WHERE user_id = p_user_id;
  DELETE FROM auth.webauthn_challenges  WHERE user_id = p_user_id;
  DELETE FROM auth.scim_users           WHERE user_id = p_user_id;

  -- ---- 11. Audit + summary ------------------------------------------------
  INSERT INTO public.account_deletions (user_id, resolution, summary, storage_status)
  VALUES (p_user_id, COALESCE(p_resolution, '{}'::jsonb),
    jsonb_build_object(
      'purged_workspaces', v_purged_workspaces,
      'purged_teams', v_purged_teams,
      'archived_teams', v_archived_teams,
      'transferred_projects', v_transferred_projects,
      'deleted_projects', v_deleted_projects),
    'pending')
  ON CONFLICT (user_id) DO UPDATE SET deleted_at = now();

  RETURN jsonb_build_object(
    'deleted', true,
    'user_id', p_user_id,
    'summary', jsonb_build_object(
      'purged_workspaces', v_purged_workspaces,
      'purged_teams', v_purged_teams,
      'archived_teams', v_archived_teams,
      'transferred_projects', v_transferred_projects,
      'deleted_projects', v_deleted_projects),
    'storage_keys', v_storage_keys
  );
END;
$$;

-- A7: the paid test reads payout_id and legacy_status; the time clean-up runs
-- under app.time_maintenance and clears entries and the fixture people's
-- emptied sheets in any status.
CREATE OR REPLACE FUNCTION public.reset_qa_fixture(
  p_key text,
  p_mark_success boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fixture public.qa_fixtures%ROWTYPE;
  v_prev_maint text := current_setting('app.time_maintenance', true);
  v_members uuid[];
BEGIN
  SELECT * INTO v_fixture
  FROM public.qa_fixtures
  WHERE key = p_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QA_FIXTURE_NOT_FOUND';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = v_fixture.project_id
      AND p.title LIKE '[QA]%'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.id = v_fixture.contract_id
      AND c.project_id = v_fixture.project_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.project_teams pt
    WHERE pt.project_id = v_fixture.project_id
      AND pt.team_id = v_fixture.primary_team_id
      AND pt.is_primary IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM public.project_teams pt
    WHERE pt.project_id = v_fixture.project_id
      AND pt.team_id = v_fixture.secondary_team_id
  ) THEN
    RAISE EXCEPTION 'QA_FIXTURE_CORE_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.project_id = v_fixture.project_id
      AND i.status <> 'draft'
  ) THEN
    RAISE EXCEPTION 'QA_FIXTURE_HAS_NON_DRAFT_INVOICE';
  END IF;

  -- Paid (a payout, or paid outside Proyekto) or legacy-marked time is a
  -- record, never fixture debris.
  IF EXISTS (
    SELECT 1 FROM public.time_entries e
    WHERE e.project_id = v_fixture.project_id
      AND (e.payout_id IS NOT NULL OR e.legacy_status IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'QA_FIXTURE_HAS_PAID_LOG';
  END IF;

  -- Entries in submitted or approved weeks are locked, and an empty
  -- non-open sheet cannot be deleted, so the time clean-up runs under
  -- app.time_maintenance.
  PERFORM set_config('app.time_maintenance', 'on', true);

  -- The fixture's people: whoever logged on it, plus its three seats.
  v_members := ARRAY(
    SELECT e.member_user_id FROM public.time_entries e
    WHERE e.project_id = v_fixture.project_id AND e.member_user_id IS NOT NULL
    UNION
    SELECT s.user_id FROM unnest(ARRAY[v_fixture.consultant_user_id, v_fixture.worker_user_id,
                                       v_fixture.client_user_id]) AS s(user_id));

  -- Reservations first: invoice_time_entries.entry_id is RESTRICT.
  DELETE FROM public.invoice_time_entries r
   USING public.time_entries e
   WHERE r.entry_id = e.id AND e.project_id = v_fixture.project_id;

  DELETE FROM public.invoices
  WHERE project_id = v_fixture.project_id
    AND status = 'draft';

  DELETE FROM public.time_entries
  WHERE project_id = v_fixture.project_id;

  -- Their sheets left empty, in any status (events cascade).
  DELETE FROM public.timesheets t
   WHERE t.member_user_id = ANY (v_members)
     AND NOT EXISTS (SELECT 1 FROM public.time_entries e WHERE e.timesheet_id = t.id);

  PERFORM set_config('app.time_maintenance', coalesce(v_prev_maint, ''), true);

  DELETE FROM public.notifications
  WHERE project_id = v_fixture.project_id
    AND user_id IN (
      v_fixture.consultant_user_id,
      v_fixture.worker_user_id,
      v_fixture.client_user_id
    );

  -- Time notifications carry no project_id (they point at a timesheet), so the
  -- fixture's own QA accounts lose theirs by type.
  DELETE FROM public.notifications n
   USING public.notification_types nt
   WHERE nt.id = n.type_id
     AND n.project_id IS NULL
     AND nt.name IN ('timesheet_submitted', 'timesheet_approved', 'timesheet_returned',
                     'timesheet_reopened', 'timesheet_reopen_requested', 'timesheet_reminder',
                     'timer_auto_stopped', 'timer_running_long', 'time_payout_recorded')
     AND n.user_id IN (
       v_fixture.consultant_user_id,
       v_fixture.worker_user_id,
       v_fixture.client_user_id
     );

  UPDATE public.teams
  SET time_tracking_enabled = true,
      updated_at = now()
  WHERE id IN (v_fixture.primary_team_id, v_fixture.secondary_team_id);

  UPDATE public.qa_fixtures
  SET last_reset_at = now(),
      last_success_at = CASE
        WHEN p_mark_success THEN now()
        ELSE last_success_at
      END
  WHERE key = p_key;

  RETURN jsonb_build_object(
    'key', v_fixture.key,
    'project_id', v_fixture.project_id,
    'contract_id', v_fixture.contract_id,
    'consultant_user_id', v_fixture.consultant_user_id,
    'worker_user_id', v_fixture.worker_user_id,
    'client_user_id', v_fixture.client_user_id,
    'primary_team_id', v_fixture.primary_team_id,
    'secondary_team_id', v_fixture.secondary_team_id
  );
END;
$$;

-- ── 99. Function privileges: service role only ────────────────────────────
-- Supabase's default privileges grant EXECUTE on new public functions to anon
-- and authenticated; CREATE OR REPLACE keeps an existing ACL. Both are
-- re-asserted here so this file alone leaves every function it creates or
-- rebuilds service-role only (the engine section revokes its own). Trigger
-- functions: REVOKE only. can_manage_team is not touched (keeps its grants).
REVOKE ALL ON FUNCTION
  public.time_policy_delete(uuid, uuid),
  public.time_legacy_sheet_facts(uuid),
  public.time_legacy_freeze(uuid),
  public.time_legacy_backfill(boolean),
  public.create_payout_and_mark_paid(uuid, uuid, uuid, text, uuid[], uuid, text, text, text, timestamptz, text),
  public.void_payout_and_revert(uuid, uuid),
  public.account_deletion_team_has_open_time(uuid),
  public.account_deletion_workspace_has_open_time(uuid),
  public.account_deletion_close_running_entries_for_workspace(uuid),
  public.time_test_cleanup(uuid),
  public.account_deletion_purge_team(uuid),
  public.account_deletion_purge_workspace(uuid),
  public.account_deletion_preflight(uuid),
  public.delete_account(uuid, jsonb),
  public.reset_qa_fixture(text, boolean)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.time_policy_delete(uuid, uuid),
  public.time_legacy_sheet_facts(uuid),
  public.time_legacy_freeze(uuid),
  public.time_legacy_backfill(boolean),
  public.create_payout_and_mark_paid(uuid, uuid, uuid, text, uuid[], uuid, text, text, text, timestamptz, text),
  public.void_payout_and_revert(uuid, uuid),
  public.account_deletion_team_has_open_time(uuid),
  public.account_deletion_workspace_has_open_time(uuid),
  public.account_deletion_close_running_entries_for_workspace(uuid),
  public.time_test_cleanup(uuid),
  public.account_deletion_purge_team(uuid),
  public.account_deletion_purge_workspace(uuid),
  public.account_deletion_preflight(uuid),
  public.delete_account(uuid, jsonb),
  public.reset_qa_fixture(text, boolean)
TO service_role;

REVOKE ALL ON FUNCTION
  public.tg_time_policies_events(),
  public.tg_time_policies_delete_event(),
  public.tg_time_entries_lock(),
  public.tg_timesheets_guard(),
  public.tg_invoice_time_entries_guard(),
  public.tg_engagement_assignment_running_timer_guard()
FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ── Verification (migrations-and-rollout > Verification SQL > M3) ─────────
-- Run on each database after the apply, dev first. Expected values in the
-- trailing comments.
--
-- No function body names the old tables (comments inside bodies included):
-- SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.prosrc ~ '(task_time_log|time_log_comments|engagement_time_approval)';  -- 0 rows
--
-- The compatibility views:
-- SELECT c.relname, c.relkind, c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relname IN ('task_time_logs','task_time_log_segments','time_log_comments');
--   -- 3 rows, relkind 'v', reloptions {security_invoker=true}
-- SELECT (SELECT count(*) FROM task_time_logs) = (SELECT count(*) FROM time_entries),
--        (SELECT count(*) FROM task_time_log_segments) = (SELECT count(*) FROM time_entry_segments),
--        (SELECT count(*) FROM time_log_comments) = (SELECT count(*) FROM time_entry_comments);  -- true, true, true
-- SELECT to_regclass('public.engagement_time_approvals'), to_regclass('public.engagement_time_approval_items');  -- NULL, NULL
-- SELECT count(*) FROM pg_policies WHERE tablename IN ('time_entries','time_entry_segments','time_entry_comments');  -- 0
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.time_entry_comments'::regclass AND NOT tgisinternal;
--   -- trg_time_entry_comments_updated_at
--
-- Grants (tables and views) and function ACLs (M1 queries, widened to every
-- function M2/M3 created or rebuilt):
-- SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
-- WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
--   AND (table_name ~ '^(time_|timesheet|task_time|team_member_rates|user_time_preferences|invoice_time_entries)'
--        OR table_name IN ('payouts','engagement_time_settings','engagement_assignments','engagement_time_rates')); -- 0 rows
-- SELECT p.oid::regprocedure, a.grantee FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
--   LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
-- WHERE n.nspname = 'public' AND a.privilege_type = 'EXECUTE'
--   AND a.grantee IN (0, 'anon'::regrole, 'authenticated'::regrole)
--   AND (p.proname ~ '^(time_|timesheet|tg_time|tg_timesheet|tg_invoice_time|account_deletion_)'
--        OR p.proname IN ('can_decide_timesheet','can_view_timesheet','delete_account','reset_qa_fixture',
--                         'create_payout_and_mark_paid','void_payout_and_revert',
--                         'tg_engagement_assignment_running_timer_guard'));  -- 0 rows
-- SELECT has_function_privilege('authenticated', 'public.can_manage_team(uuid,uuid)', 'EXECUTE');  -- true (kept)
-- The engine's internal helpers are not callable even by service_role (only
-- through the SECURITY DEFINER transition and routing preview):
-- SELECT has_function_privilege('service_role', 'public.time_apply_freeze(uuid,jsonb)', 'EXECUTE'),
--        has_function_privilege('service_role', 'public.time_clear_freeze(uuid)', 'EXECUTE'),
--        has_function_privilege('service_role', 'public.time_route_sheet(public.timesheets,text)', 'EXECUTE');
--   -- false, false, false
--
-- Policy audit (D23):
-- SELECT is_nullable FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'time_policy_events' AND column_name = 'policy_id';  -- YES
-- SELECT confdeltype FROM pg_constraint WHERE conname = 'time_policy_events_policy_id_fkey';  -- n (SET NULL)
-- SELECT count(*) FROM time_policy_events e JOIN time_policies p ON p.id = e.policy_id
-- WHERE (e.scope, e.team_id, e.workspace_id) IS DISTINCT FROM (p.scope, p.team_id, p.workspace_id);  -- 0
-- SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.time_policies'::regclass AND NOT tgisinternal ORDER BY 1;
--   -- trg_time_policies_delete_event, trg_time_policies_events, trg_time_policies_guard
--
-- The account-deletion helper swap:
-- SELECT to_regprocedure('public.account_deletion_close_running_logs_for_workspace(uuid)'),
--        to_regprocedure('public.account_deletion_close_running_entries_for_workspace(uuid)');  -- NULL, set
--
-- Dev: the MD-15 embed check (blueprint §6.5) and
-- backend/test/integration/time-rename-compat.integration-spec.ts.
-- Dev smoke (BEGIN … ROLLBACK): call each rebuilt function once (payout
--   create/void, transition submit/approve/return/reopen, reset_qa_fixture,
--   account_deletion_preflight, time_stop_running_entries, time_policy_delete).
