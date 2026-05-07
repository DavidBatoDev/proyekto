-- Migration: 20260507000090_project_briefs_summary_and_custom_fields.sql
-- Date: May 7, 2026
-- Description:
--   Collapse the multi-column brief into a single `project_summary`
--   text field plus a flexible `custom_fields` JSONB array of
--   { key, value, position } rows that the overview page renders as a
--   user-defined list.
--
--   Per the planning Q&A, legacy text columns are dropped without
--   backfilling their content into the new shape. mission_vision is
--   NOT carried into project_summary — projects whose summary mattered
--   should be re-entered on /overview after this lands. The optional
--   carry-over UPDATE is left commented for reference.
--
--   RLS policies from 20260507000080_project_briefs_rls_via_project_access
--   keep working unchanged — they don't reference any of the dropped
--   columns.

-- 1. Add new columns first so a mid-deploy read still has rows that
--    answer to the new schema.
ALTER TABLE public.project_briefs
  ADD COLUMN IF NOT EXISTS project_summary text,
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. (Optional) Carry mission_vision into project_summary. Disabled by
--    decision; uncomment if a future migration wants to preserve copy.
-- UPDATE public.project_briefs
-- SET project_summary = mission_vision
-- WHERE project_summary IS NULL AND mission_vision IS NOT NULL;

-- 3. Drop legacy columns. CASCADE not needed — no FK or policy
--    references them after migration 20260507000080.
ALTER TABLE public.project_briefs
  DROP COLUMN IF EXISTS mission_vision,
  DROP COLUMN IF EXISTS scope_statement,
  DROP COLUMN IF EXISTS requirements,
  DROP COLUMN IF EXISTS constraints,
  DROP COLUMN IF EXISTS risk_register,
  DROP COLUMN IF EXISTS visibility_mask,
  DROP COLUMN IF EXISTS notes;

-- 4. Cheap shape guard: custom_fields must always be a JSON array. The
--    individual row shape (string key/value, integer position) is
--    enforced client-side; we only block "not an array" at the DB to
--    keep the constraint fast and avoid jsonpath in a CHECK.
ALTER TABLE public.project_briefs
  DROP CONSTRAINT IF EXISTS project_briefs_custom_fields_is_array;

ALTER TABLE public.project_briefs
  ADD CONSTRAINT project_briefs_custom_fields_is_array
    CHECK (jsonb_typeof(custom_fields) = 'array');
