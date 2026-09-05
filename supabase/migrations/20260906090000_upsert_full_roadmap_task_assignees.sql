-- upsert_full_roadmap: write the roadmap_task_assignees join table, not just
-- the legacy roadmap_tasks.assignee_id mirror.
--
-- Tasks have had multiple assignees since 20260704000000_create_assignee_join_tables.sql
-- (join table public.roadmap_task_assignees). Every direct task write path
-- reconciles the join table, but this RPC — the AI commit / rollback /
-- re-apply path and the legacy full-roadmap JSON-patch path — only ever wrote
-- the column, so an AI edit could never add a co-assignee and a legacy
-- single-assignee write silently left stale join rows behind.
--
-- Enforced invariant (from this migration on):
--   * roadmap_tasks.assignee_id IS the primary assignee — the stored column,
--     nothing derived. It is always one of the task's assignees, or NULL when
--     the task has none.
--   * roadmap_task_assignees is MEMBERSHIP ONLY: which users are assigned. It
--     persists no order (assigned_at is bookkeeping, not rank), so the primary
--     can never be "whichever join row sorts first".
--   * Readers put the stored primary first, then the rest by assigned_at:
--     ai_context_list_tasks (rebuilt below) orders its aggregate by
--     (a.assignee_id = t.assignee_id) DESC, and the backend's findFull rotates
--     the column value to the front of the embedded join rows.
--
-- This file, in order:
--   1. DROP + CREATE public.upsert_full_roadmap with the 6-arg signature.
--   2. Idempotent backfill so the column and the join table agree on every
--      existing row — deliberately placed BEFORE the join-table trigger is
--      created (see that section for why).
--   3. touch_roadmap_from_task_assignee_change() + its trigger, with EXECUTE
--      revoked from public/anon/authenticated (PostgREST exposes every public
--      function at /rest/v1/rpc; same remediation as 20260801080557).
--   4. public.ai_context_list_tasks rebuilt from its 20260904090000 body with
--      the stored primary ordered first in assignee_ids.
--
-- Body rebuilt from the NEWEST defining migration,
-- 20260809120000_restore_feature_status.sql (latest-function-body rule); the
-- only edits are inside the `FOR v_task ... WITH ORDINALITY` loop plus the new
-- trailing `p_actor_id` parameter (recorded as roadmap_task_assignees.assigned_by,
-- falling back to p_owner_id). Nothing else in the body changes.
--
-- Signature change: the old 5-arg overload is dropped first, otherwise
-- CREATE OR REPLACE with a new parameter list would leave BOTH overloads in
-- place and PostgREST could not resolve the RPC name unambiguously.
--
-- Grants: no migration has ever GRANTed or REVOKEd on upsert_full_roadmap
-- (grep'd every file under supabase/migrations/), so the function has only
-- ever carried the schema's default function privileges. Recreating it with
-- no explicit GRANT/REVOKE reproduces exactly that final state.
--
-- Per-task semantics (also documented in COMMENT ON FUNCTION below):
--   * `assignee_ids` (jsonb array of user ids) is the canonical FULL
--     REPLACEMENT set: ids are deduped preserving first-seen order, invalid /
--     non-uuid elements are dropped, and the first id becomes the column value
--     (`roadmap_tasks.assignee_id`); an empty array unassigns everyone.
--   * `assignee_id` alone (key `assignee_ids` absent) is the legacy scalar
--     alias: `X` means `[X]`, null/absent means `[]` — but ONLY when it actually
--     changes the stored column (or the task row is new). An unchanged scalar
--     leaves the join table untouched, so unrelated edits through a legacy
--     single-assignee writer never drop co-assignees.
--   * Mirror rule: after this call `roadmap_tasks.assignee_id` always equals
--     the first element of the task's effective set (NULL when empty), and
--     that column — not join-row order — is what every reader treats as the
--     primary.
--
-- Worked scenarios (task T currently has join rows {A, B}, column = A):
--
--   (a) key present and changed — payload task carries
--       `"assignee_ids": ["B", "C", "B"]`
--       -> v_has_assignee_ids = true; v_assignee_ids = {B, C} (dup dropped,
--          order kept); column := B (v_assignee_ids[1]).
--       -> DELETE join rows NOT IN {B, C}  => A removed.
--       -> INSERT B (conflict: already present, DO NOTHING, keeps its original
--          assigned_at) and C (new row, assigned_by = p_actor_id or owner).
--       Result: join rows {B, C}, column = B. (With `"assignee_ids": []` the
--       DELETE removes every row and the column becomes NULL.)
--
--   (b) key ABSENT + scalar unchanged — payload task carries
--       `"assignee_id": "A"` and no `assignee_ids` key (e.g. a raw RPC caller
--       that sends only the scalar)
--       -> v_has_assignee_ids = false; v_primary_assignee_id = A;
--          v_task_exists = true; stored column A IS NOT DISTINCT FROM A.
--       -> Neither reconciliation branch runs: the join table is UNTOUCHED.
--       Result: join rows {A, B}, column = A (co-assignee B survives).
--
--   (c) key ABSENT + scalar changed — payload task carries
--       `"assignee_id": "C"` and no `assignee_ids` key (a legacy
--       single-assignee writer changing the assignment)
--       -> v_has_assignee_ids = false; v_primary_assignee_id = C;
--          v_task_exists = true; stored column A IS DISTINCT FROM C.
--       -> Join table reconciled to [C]: DELETE rows <> C (A and B removed),
--          INSERT C.
--       Result: join rows {C}, column = C. (With `"assignee_id": null` the
--       column becomes NULL and every join row is deleted — set `{}`.)
--
--   New task rows (v_task_exists = false) with a scalar `assignee_id` and no
--   `assignee_ids` key take the same branch as (c) and get exactly one join
--   row; a new task with neither field gets none.
--
-- Also adds an AFTER INSERT OR DELETE trigger on public.roadmap_task_assignees
-- (mirroring touch_roadmap_from_task_change in
-- 20260801080313_roadmap_activity_cascade.sql) so a co-assignee-only change
-- bumps roadmaps.updated_at and therefore advances the STALE_REVISION guard.
--
-- Apply through the Supabase MCP apply_migration tool (dev vyiedlwasdwmjbztqznl,
-- then prod byvbnkpiselvvulsvxgo) — never `supabase db push`. Re-applying is
-- safe: every statement is CREATE OR REPLACE / DROP IF EXISTS / ON CONFLICT
-- DO NOTHING / a no-op WHERE.

DROP FUNCTION IF EXISTS public.upsert_full_roadmap(uuid, uuid, jsonb, boolean, timestamptz);

CREATE OR REPLACE FUNCTION public.upsert_full_roadmap(
  p_roadmap_id uuid,
  p_owner_id uuid,
  p_full_state jsonb,
  p_create_if_missing boolean DEFAULT false,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
AS $$
DECLARE
  v_roadmap_id uuid;
  v_existing_owner_id uuid;

  v_epic jsonb;
  v_feature jsonb;
  v_task jsonb;

  v_epic_id uuid;
  v_feature_id uuid;
  v_task_id uuid;

  v_epic_index integer;
  v_feature_index integer;
  v_task_index integer;

  v_milestone jsonb;
  v_milestone_id uuid;
  v_milestone_index integer;

  -- Task assignee reconciliation (see header comment).
  v_has_assignee_ids boolean;
  v_assignee_ids uuid[];
  v_primary_assignee_id uuid;
  v_existing_assignee_id uuid;
  v_task_exists boolean;

  incoming_milestone_ids uuid[] := ARRAY[]::uuid[];
  incoming_epic_ids uuid[] := ARRAY[]::uuid[];
  incoming_feature_ids uuid[] := ARRAY[]::uuid[];
  incoming_task_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  v_roadmap_id := COALESCE((p_full_state ->> 'id')::uuid, p_roadmap_id);

  IF v_roadmap_id IS NULL THEN
    RAISE EXCEPTION 'Roadmap id is required';
  END IF;

  IF p_owner_id IS NULL THEN
    RAISE EXCEPTION 'Owner id is required';
  END IF;

  SELECT owner_id
  INTO v_existing_owner_id
  FROM public.roadmaps
  WHERE id = v_roadmap_id;

  IF v_existing_owner_id IS NULL THEN
    IF NOT p_create_if_missing THEN
      RAISE EXCEPTION 'Roadmap % not found', v_roadmap_id;
    END IF;

    INSERT INTO public.roadmaps (
      id,
      owner_id,
      project_id,
      name,
      description,
      status,
      start_date,
      end_date,
      settings,
      updated_at
    )
    VALUES (
      v_roadmap_id,
      p_owner_id,
      NULLIF(p_full_state ->> 'project_id', '')::uuid,
      p_full_state ->> 'name',
      p_full_state ->> 'description',
      COALESCE(NULLIF(p_full_state ->> 'status', ''), 'draft')::roadmap_status,
      NULLIF(p_full_state ->> 'start_date', '')::timestamptz,
      NULLIF(p_full_state ->> 'end_date', '')::timestamptz,
      COALESCE(p_full_state -> 'settings', '{}'::jsonb),
      NOW()
    );
  ELSE
    IF v_existing_owner_id <> p_owner_id THEN
      RAISE EXCEPTION 'Not the owner';
    END IF;

    -- Opt-in optimistic-concurrency guard: when a baseline is supplied, the
    -- UPDATE only matches if updated_at is still that baseline. A concurrent
    -- writer that bumped updated_at leaves 0 rows matched → STALE_REVISION.
    UPDATE public.roadmaps
    SET
      owner_id = p_owner_id,
      project_id = NULLIF(p_full_state ->> 'project_id', '')::uuid,
      name = COALESCE(p_full_state ->> 'name', name),
      description = COALESCE(p_full_state ->> 'description', description),
      status = COALESCE(NULLIF(p_full_state ->> 'status', ''), status::text)::roadmap_status,
      start_date = COALESCE(NULLIF(p_full_state ->> 'start_date', '')::timestamptz, start_date),
      end_date = COALESCE(NULLIF(p_full_state ->> 'end_date', '')::timestamptz, end_date),
      settings = COALESCE(p_full_state -> 'settings', settings),
      updated_at = NOW()
    WHERE id = v_roadmap_id
      AND (p_expected_updated_at IS NULL OR updated_at = p_expected_updated_at);

    IF p_expected_updated_at IS NOT NULL AND NOT FOUND THEN
      RAISE EXCEPTION 'STALE_REVISION' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Evacuate live positions so the row-by-row upserts below can never collide
  -- with a row that is reordered or deleted later in this same call.
  UPDATE public.roadmap_epics
  SET position = position + 1000000
  WHERE roadmap_id = v_roadmap_id;

  UPDATE public.roadmap_features f
  SET position = f.position + 1000000
  FROM public.roadmap_epics e
  WHERE f.epic_id = e.id
    AND e.roadmap_id = v_roadmap_id;

  UPDATE public.roadmap_tasks t
  SET position = t.position + 1000000
  FROM public.roadmap_features f, public.roadmap_epics e
  WHERE t.feature_id = f.id
    AND f.epic_id = e.id
    AND e.roadmap_id = v_roadmap_id;


  IF p_full_state ? 'roadmap_milestones' THEN
    UPDATE public.roadmap_milestones
    SET position = position + 1000000
    WHERE roadmap_id = v_roadmap_id;
  END IF;

  FOR v_milestone, v_milestone_index IN
    SELECT value, ordinality::int
    FROM jsonb_array_elements(COALESCE(p_full_state -> 'roadmap_milestones', '[]'::jsonb)) WITH ORDINALITY
  LOOP
    v_milestone_id := COALESCE(NULLIF(v_milestone ->> 'id', '')::uuid, gen_random_uuid());

    INSERT INTO public.roadmap_milestones (
      id,
      roadmap_id,
      title,
      description,
      status,
      target_date,
      completed_date,
      position,
      color,
      updated_at
    )
    VALUES (
      v_milestone_id,
      v_roadmap_id,
      v_milestone ->> 'title',
      v_milestone ->> 'description',
      COALESCE(NULLIF(v_milestone ->> 'status', ''), 'not_started')::roadmap_milestone_status,
      (v_milestone ->> 'target_date')::timestamptz,
      NULLIF(v_milestone ->> 'completed_date', '')::timestamptz,
      COALESCE(NULLIF(v_milestone ->> 'position', '')::int, v_milestone_index - 1),
      v_milestone ->> 'color',
      NOW()
    )
    ON CONFLICT (id)
    DO UPDATE SET
      roadmap_id = EXCLUDED.roadmap_id,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      status = EXCLUDED.status,
      target_date = EXCLUDED.target_date,
      completed_date = EXCLUDED.completed_date,
      position = EXCLUDED.position,
      color = EXCLUDED.color,
      updated_at = NOW();

    incoming_milestone_ids := array_append(incoming_milestone_ids, v_milestone_id);
  END LOOP;

  IF p_full_state ? 'roadmap_milestones' THEN
    IF cardinality(incoming_milestone_ids) = 0 THEN
      DELETE FROM public.roadmap_milestones m
      WHERE m.roadmap_id = v_roadmap_id;
    ELSE
      DELETE FROM public.roadmap_milestones m
      WHERE m.roadmap_id = v_roadmap_id
        AND NOT (m.id = ANY (incoming_milestone_ids));
    END IF;
  END IF;

  FOR v_epic, v_epic_index IN
    SELECT value, ordinality::int
    FROM jsonb_array_elements(COALESCE(p_full_state -> 'roadmap_epics', '[]'::jsonb)) WITH ORDINALITY
  LOOP
    v_epic_id := COALESCE(NULLIF(v_epic ->> 'id', '')::uuid, gen_random_uuid());

    INSERT INTO public.roadmap_epics (
      id,
      roadmap_id,
      title,
      description,
      priority,
      status,
      position,
      color,
      start_date,
      end_date,
      tags,
      updated_at
    )
    VALUES (
      v_epic_id,
      v_roadmap_id,
      v_epic ->> 'title',
      v_epic ->> 'description',
      COALESCE(NULLIF(v_epic ->> 'priority', ''), 'medium')::epic_priority,
      COALESCE(NULLIF(v_epic ->> 'status', ''), 'backlog')::epic_status,
      COALESCE(NULLIF(v_epic ->> 'position', '')::int, v_epic_index - 1),
      v_epic ->> 'color',
      NULLIF(v_epic ->> 'start_date', '')::timestamptz,
      NULLIF(v_epic ->> 'end_date', '')::timestamptz,
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_epic -> 'tags', '[]'::jsonb))),
        ARRAY[]::text[]
      ),
      NOW()
    )
    ON CONFLICT (id)
    DO UPDATE SET
      roadmap_id = EXCLUDED.roadmap_id,
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      priority = EXCLUDED.priority,
      status = EXCLUDED.status,
      position = EXCLUDED.position,
      color = EXCLUDED.color,
      start_date = EXCLUDED.start_date,
      end_date = EXCLUDED.end_date,
      tags = EXCLUDED.tags,
      updated_at = NOW();

    incoming_epic_ids := array_append(incoming_epic_ids, v_epic_id);

    FOR v_feature, v_feature_index IN
      SELECT value, ordinality::int
      FROM jsonb_array_elements(COALESCE(v_epic -> 'roadmap_features', '[]'::jsonb)) WITH ORDINALITY
    LOOP
      v_feature_id := COALESCE(NULLIF(v_feature ->> 'id', '')::uuid, gen_random_uuid());

      INSERT INTO public.roadmap_features (
        id,
        epic_id,
        roadmap_id,
        title,
        description,
        position,
        is_deliverable,
        status,
        start_date,
        end_date,
        updated_at
      )
      VALUES (
        v_feature_id,
        v_epic_id,
        v_roadmap_id,
        v_feature ->> 'title',
        v_feature ->> 'description',
        COALESCE(NULLIF(v_feature ->> 'position', '')::int, v_feature_index - 1),
        COALESCE(NULLIF(v_feature ->> 'is_deliverable', '')::boolean, true),
        COALESCE(NULLIF(v_feature ->> 'status', ''), 'not_started')::feature_status,
        NULLIF(v_feature ->> 'start_date', '')::timestamptz,
        NULLIF(v_feature ->> 'end_date', '')::timestamptz,
        NOW()
      )
      ON CONFLICT (id)
      DO UPDATE SET
        epic_id = EXCLUDED.epic_id,
        roadmap_id = EXCLUDED.roadmap_id,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        position = EXCLUDED.position,
        is_deliverable = EXCLUDED.is_deliverable,
        status = EXCLUDED.status,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        updated_at = NOW();

      incoming_feature_ids := array_append(incoming_feature_ids, v_feature_id);

      FOR v_task, v_task_index IN
        SELECT value, ordinality::int
        FROM jsonb_array_elements(COALESCE(v_feature -> 'roadmap_tasks', '[]'::jsonb)) WITH ORDINALITY
      LOOP
        v_task_id := COALESCE(NULLIF(v_task ->> 'id', '')::uuid, gen_random_uuid());

        -- ── Effective assignee set (see header) ─────────────────────────────
        -- `assignee_ids` is only honoured when it is a real JSON array; a
        -- null / missing / non-array value falls through to the legacy scalar.
        v_has_assignee_ids :=
          (v_task ? 'assignee_ids')
          AND jsonb_typeof(v_task -> 'assignee_ids') = 'array';

        IF v_has_assignee_ids THEN
          -- Dedupe preserving first-seen order: keep an element only when no
          -- earlier element (case-insensitively) equals it. Elements that are
          -- not uuid-shaped strings (null, numbers, junk) are dropped rather
          -- than failing the whole commit.
          v_assignee_ids := ARRAY(
            SELECT t.x::uuid
            FROM jsonb_array_elements_text(v_task -> 'assignee_ids') WITH ORDINALITY AS t(x, ord)
            WHERE t.x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(v_task -> 'assignee_ids') WITH ORDINALITY AS p(x, ord)
                WHERE p.ord < t.ord
                  AND lower(p.x) = lower(t.x)
              )
            ORDER BY t.ord
          );
          -- First id is the primary; NULL when the set is empty.
          v_primary_assignee_id := v_assignee_ids[1];
        ELSE
          v_assignee_ids := NULL;
          v_primary_assignee_id := NULLIF(v_task ->> 'assignee_id', '')::uuid;
        END IF;

        -- Capture the stored primary BEFORE the upsert so a legacy scalar
        -- writer (key absent) can be told apart from an unrelated edit.
        SELECT t.assignee_id
        INTO v_existing_assignee_id
        FROM public.roadmap_tasks t
        WHERE t.id = v_task_id
        FOR UPDATE;
        v_task_exists := FOUND;
        IF NOT v_task_exists THEN
          v_existing_assignee_id := NULL;
        END IF;

        INSERT INTO public.roadmap_tasks (
          id,
          feature_id,
          assignee_id,
          title,
          status,
          priority,
          position,
          due_date,
          updated_at
        )
        VALUES (
          v_task_id,
          v_feature_id,
          v_primary_assignee_id,
          v_task ->> 'title',
          COALESCE(NULLIF(v_task ->> 'status', ''), 'todo')::task_status,
          COALESCE(NULLIF(v_task ->> 'priority', ''), 'medium')::task_priority,
          COALESCE(NULLIF(v_task ->> 'position', '')::int, v_task_index - 1),
          NULLIF(v_task ->> 'due_date', '')::timestamptz,
          NOW()
        )
        ON CONFLICT (id)
        DO UPDATE SET
          feature_id = EXCLUDED.feature_id,
          assignee_id = EXCLUDED.assignee_id,
          title = EXCLUDED.title,
          status = EXCLUDED.status,
          priority = EXCLUDED.priority,
          position = EXCLUDED.position,
          due_date = EXCLUDED.due_date,
          updated_at = NOW();

        -- ── Join-table reconciliation ───────────────────────────────────────
        IF v_has_assignee_ids THEN
          -- Scenario (a): explicit full set. Remove what is no longer in the
          -- set (everything, when the set is empty), then add what is missing.
          -- Existing rows are left alone by ON CONFLICT so their assigned_at
          -- (and therefore "first assigned" ordering) survives.
          DELETE FROM public.roadmap_task_assignees a
          WHERE a.task_id = v_task_id
            AND NOT (a.assignee_id = ANY (v_assignee_ids));

          INSERT INTO public.roadmap_task_assignees (task_id, assignee_id, assigned_by)
          SELECT v_task_id, u, COALESCE(p_actor_id, p_owner_id)
          FROM unnest(v_assignee_ids) AS u
          ON CONFLICT (task_id, assignee_id) DO NOTHING;
        ELSIF NOT v_task_exists
           OR v_existing_assignee_id IS DISTINCT FROM v_primary_assignee_id THEN
          -- Scenario (c) and new task rows: a legacy single-assignee writer is
          -- (re)assigning, so the set becomes [primary] — or {} when NULL.
          DELETE FROM public.roadmap_task_assignees a
          WHERE a.task_id = v_task_id
            AND (v_primary_assignee_id IS NULL OR a.assignee_id <> v_primary_assignee_id);

          IF v_primary_assignee_id IS NOT NULL THEN
            INSERT INTO public.roadmap_task_assignees (task_id, assignee_id, assigned_by)
            VALUES (v_task_id, v_primary_assignee_id, COALESCE(p_actor_id, p_owner_id))
            ON CONFLICT (task_id, assignee_id) DO NOTHING;
          END IF;
        END IF;
        -- Scenario (b) — key absent, task exists, scalar unchanged — takes
        -- neither branch: the join table is deliberately left untouched.

        incoming_task_ids := array_append(incoming_task_ids, v_task_id);
      END LOOP;
    END LOOP;
  END LOOP;

  IF cardinality(incoming_task_ids) = 0 THEN
    DELETE FROM public.roadmap_tasks t
    USING public.roadmap_features f, public.roadmap_epics e
    WHERE t.feature_id = f.id
      AND f.epic_id = e.id
      AND e.roadmap_id = v_roadmap_id;
  ELSE
    DELETE FROM public.roadmap_tasks t
    USING public.roadmap_features f, public.roadmap_epics e
    WHERE t.feature_id = f.id
      AND f.epic_id = e.id
      AND e.roadmap_id = v_roadmap_id
      AND NOT (t.id = ANY (incoming_task_ids));
  END IF;

  IF cardinality(incoming_feature_ids) = 0 THEN
    DELETE FROM public.roadmap_features f
    USING public.roadmap_epics e
    WHERE f.epic_id = e.id
      AND e.roadmap_id = v_roadmap_id;
  ELSE
    DELETE FROM public.roadmap_features f
    USING public.roadmap_epics e
    WHERE f.epic_id = e.id
      AND e.roadmap_id = v_roadmap_id
      AND NOT (f.id = ANY (incoming_feature_ids));
  END IF;

  IF cardinality(incoming_epic_ids) = 0 THEN
    DELETE FROM public.roadmap_epics e
    WHERE e.roadmap_id = v_roadmap_id;
  ELSE
    DELETE FROM public.roadmap_epics e
    WHERE e.roadmap_id = v_roadmap_id
      AND NOT (e.id = ANY (incoming_epic_ids));
  END IF;

  RETURN (SELECT updated_at FROM public.roadmaps WHERE id = v_roadmap_id);
END;
$$;

COMMENT ON FUNCTION public.upsert_full_roadmap(uuid, uuid, jsonb, boolean, timestamptz, uuid) IS
  'Full-roadmap upsert (AI commit/rollback and legacy JSON-patch path). Task assignees: `assignee_ids` (jsonb array) is the canonical full-replacement set — deduped preserving order, first id mirrored into roadmap_tasks.assignee_id, [] unassigns everyone, join table roadmap_task_assignees reconciled (existing rows keep assigned_at, new rows get assigned_by = p_actor_id or p_owner_id). When the key is absent, scalar `assignee_id` is a legacy alias that reconciles the join table to [id] / {} ONLY if it differs from the stored column (or the task is new); an unchanged scalar leaves co-assignees untouched. Body source: 20260809120000 + 20260906090000.';

-- ============================================================================
-- Idempotent backfill: make the column and the join table agree on every
-- existing task BEFORE the join-table trigger below exists.
--
-- Why before the trigger: the first statement inserts a join row for every
-- task whose column is set but has no matching row (rows the pre-2026-09 RPC
-- wrote column-only — 74 in prod at authoring time). Were the
-- roadmap_task_assignees_touch_roadmap trigger already in place, each of
-- those inserts would bump roadmaps.updated_at at apply time, invalidating the
-- revision_token of every open editor on those roadmaps (their next commit
-- would 409 STALE_REVISION) although nothing visible changed. Running the
-- backfill first means the inserts fire no trigger at all.
--
-- The second statement is the mirror direction: a NULL column while join rows
-- exist (never produced by any shipped writer — expected to match zero rows,
-- kept for completeness and re-runs). Any row it does touch fires the existing
-- roadmap_tasks_touch_roadmap / update_roadmap_tasks_updated_at triggers,
-- which is correct there: that task's visible primary assignee really changes.
--
-- Both statements are safe to re-run: ON CONFLICT DO NOTHING and a WHERE that
-- no longer matches once the data agrees.
-- ============================================================================

INSERT INTO public.roadmap_task_assignees (task_id, assignee_id)
SELECT t.id, t.assignee_id
  FROM public.roadmap_tasks t
 WHERE t.assignee_id IS NOT NULL
ON CONFLICT (task_id, assignee_id) DO NOTHING;

UPDATE public.roadmap_tasks t
   SET assignee_id = (
         SELECT a.assignee_id
           FROM public.roadmap_task_assignees a
          WHERE a.task_id = t.id
          ORDER BY a.assigned_at, a.assignee_id
          LIMIT 1
       )
 WHERE t.assignee_id IS NULL
   AND EXISTS (
         SELECT 1
           FROM public.roadmap_task_assignees a
          WHERE a.task_id = t.id
       );

-- ============================================================================
-- roadmap_task_assignees -> roadmaps.updated_at activity cascade.
-- Mirrors touch_roadmap_from_task_change (20260801080313): task ->
-- roadmap_features.roadmap_id -> bump roadmaps.updated_at, SECURITY DEFINER
-- with the same pinned search_path, so a co-assignee-only change advances the
-- STALE_REVISION revision token. The join table has no UPDATE path (rows are
-- only ever inserted or deleted), hence AFTER INSERT OR DELETE. When the row
-- disappears because its task is being deleted (FK cascade) the task lookup
-- finds nothing and this is a no-op — the task's own trigger already bumped.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.touch_roadmap_from_task_assignee_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_roadmap_id uuid;
  v_task_id uuid := COALESCE(NEW.task_id, OLD.task_id);
BEGIN
  SELECT f.roadmap_id INTO v_roadmap_id
  FROM public.roadmap_tasks t
  JOIN public.roadmap_features f ON f.id = t.feature_id
  WHERE t.id = v_task_id;

  IF v_roadmap_id IS NOT NULL THEN
    UPDATE public.roadmaps SET updated_at = now() WHERE id = v_roadmap_id;
  END IF;

  RETURN NULL;
END;
$$;

-- Pure trigger function (RETURNS trigger): Postgres invokes it as part of the
-- owning table's DML without the caller needing EXECUTE, so revoking it only
-- blocks direct /rest/v1/rpc calls by anon/authenticated — the same
-- remediation 20260801080557 applied to the other SECURITY DEFINER touch
-- functions (get_advisors otherwise flags it).
REVOKE EXECUTE ON FUNCTION public.touch_roadmap_from_task_assignee_change()
  FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS roadmap_task_assignees_touch_roadmap ON public.roadmap_task_assignees;
CREATE TRIGGER roadmap_task_assignees_touch_roadmap
  AFTER INSERT OR DELETE ON public.roadmap_task_assignees
  FOR EACH ROW EXECUTE FUNCTION public.touch_roadmap_from_task_assignee_change();

COMMENT ON FUNCTION public.touch_roadmap_from_task_assignee_change IS
  'Bumps roadmaps.updated_at when a task assignee join row is added or removed (task -> roadmap_features.roadmap_id), so co-assignee-only edits advance the roadmap revision token.';

-- ============================================================================
-- public.ai_context_list_tasks: stored primary first in assignee_ids.
--
-- Body copied verbatim from its NEWEST defining migration,
-- 20260904090000_ai_sessions_scope_and_context_rpcs.sql (latest-function-body
-- rule), signature unchanged (CREATE OR REPLACE, no DROP). The ONLY edit is
-- the aggregate ordering: `ORDER BY a.assigned_at, a.assignee_id` becomes
-- `ORDER BY (a.assignee_id = t.assignee_id) DESC, a.assigned_at, a.assignee_id`
-- so assignee_ids[1] is the stored roadmap_tasks.assignee_id whenever the
-- task has one — the same "primary first" contract the backend's findFull
-- applies to its embedded join rows. The COMMENT / REVOKE / GRANT lines that
-- followed the original definition are re-applied unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.ai_context_list_tasks(
  p_roadmap_ids uuid[],
  p_assignee uuid DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_due_from timestamptz DEFAULT NULL,
  p_due_to timestamptz DEFAULT NULL,
  p_overdue_at timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  title text,
  status text,
  priority text,
  due_date timestamptz,
  updated_at timestamptz,
  feature_id uuid,
  feature_title text,
  epic_id uuid,
  epic_title text,
  roadmap_id uuid,
  assignee_ids uuid[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  -- Status semantics: a NULL status counts as 'todo', so it matches an 'open'
  -- filter (todo|in_progress|in_review|blocked) but never 'blocked' alone.
  -- Assignee semantics: the roadmap_task_assignees join table OR the legacy
  -- roadmap_tasks.assignee_id mirror (same set semantics as the in-roadmap
  -- getContextTasksAssignedToMe (join table or the legacy column)).
  SELECT t.id,
         t.title,
         COALESCE(t.status::text, 'todo') AS status,
         t.priority::text AS priority,
         t.due_date,
         t.updated_at,
         f.id AS feature_id,
         f.title AS feature_title,
         e.id AS epic_id,
         e.title AS epic_title,
         f.roadmap_id,
         COALESCE(
           (SELECT array_agg(a.assignee_id ORDER BY (a.assignee_id = t.assignee_id) DESC, a.assigned_at, a.assignee_id)
              FROM public.roadmap_task_assignees a
             WHERE a.task_id = t.id),
           CASE
             WHEN t.assignee_id IS NULL THEN '{}'::uuid[]
             ELSE ARRAY[t.assignee_id]
           END
         ) AS assignee_ids
    FROM public.roadmap_tasks t
    JOIN public.roadmap_features f ON f.id = t.feature_id
    JOIN public.roadmap_epics e ON e.id = f.epic_id
   WHERE f.roadmap_id = ANY (p_roadmap_ids)
     AND (p_assignee IS NULL
          OR t.assignee_id = p_assignee
          OR EXISTS (
               SELECT 1
                 FROM public.roadmap_task_assignees a
                WHERE a.task_id = t.id
                  AND a.assignee_id = p_assignee))
     AND (p_statuses IS NULL OR COALESCE(t.status::text, 'todo') = ANY (p_statuses))
     AND (p_due_from IS NULL OR t.due_date >= p_due_from)
     AND (p_due_to IS NULL OR t.due_date <= p_due_to)
     AND (p_overdue_at IS NULL
          OR (t.due_date IS NOT NULL
              AND t.due_date < p_overdue_at
              AND COALESCE(t.status::text, 'todo') <> 'done'))
   ORDER BY (t.due_date IS NULL), t.due_date ASC, t.updated_at DESC NULLS LAST
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;

COMMENT ON FUNCTION public.ai_context_list_tasks(uuid[], uuid, text[], timestamptz, timestamptz, timestamptz, integer) IS
  'Cross-roadmap task listing for the AI context surface with feature/epic/roadmap attribution and assignee_ids (join table OR legacy assignee_id). NULL status counts as todo; cap 200. Callers pass pre-authorized roadmap ids; service_role only.';

REVOKE ALL ON FUNCTION public.ai_context_list_tasks(uuid[], uuid, text[], timestamptz, timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ai_context_list_tasks(uuid[], uuid, text[], timestamptz, timestamptz, timestamptz, integer)
  TO service_role;
