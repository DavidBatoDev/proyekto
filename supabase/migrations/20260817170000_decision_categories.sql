-- Decision categories: a per-project, user-definable taxonomy.
--
-- Deliberately a table rather than a CHECK list. Every other dimension on the
-- governance surfaces (risk severity, evidence category, change-request status)
-- is text + CHECK, which is right for a vocabulary the product owns. Category is
-- the opposite case: an agency's categories are its own, and a fixed enum forces
-- every project into one shape.
--
-- NOTHING IS SEEDED HERE, and that is the load-bearing decision. This codebase
-- tried per-project seeded rows once — chat_rooms.system_key, added
-- 20260620000000 and dropped 20260621000000 one day later — and moved the
-- defaults to client-side presets instead (web/src/components/project/chat/
-- channelSuggestions.ts). The six suggested categories live in web as
-- CATEGORY_PRESETS; picking one creates an ordinary row. A project that never
-- opens the picker has zero rows here, and the backend never has to know which
-- categories are "special".
--
-- color and icon are CONSTRAINED KEY SETS, not free text. Storing a hex value is
-- what web/src/types/label.ts does (30 raw hex constants forcing
-- style={{backgroundColor}}), and it is exactly the dark-mode failure the
-- delivery surfaces were rebuilt to escape. A key resolved through a map in web
-- keeps every category inside the theme-token system.

BEGIN;

CREATE TABLE IF NOT EXISTS public.project_decision_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- A token key (see CATEGORY_ACCENT in web/src/components/project/delivery/
  -- decisionModel.ts), never a hex value.
  color text NOT NULL DEFAULT 'slate',
  -- A key into CATEGORY_ICON in the same file.
  icon text NOT NULL DEFAULT 'tag',
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_decision_categories_name_not_blank
    CHECK (length(btrim(name)) > 0),
  CONSTRAINT project_decision_categories_color_check
    CHECK (color IN (
      'slate', 'blue', 'violet', 'teal', 'amber', 'rose', 'emerald', 'indigo')),
  CONSTRAINT project_decision_categories_icon_check
    CHECK (icon IN (
      'tag', 'cpu', 'palette', 'crosshair', 'briefcase', 'workflow',
      'shield', 'database'))
);

COMMENT ON TABLE public.project_decision_categories IS
  'Per-project decision taxonomy. Nothing is seeded; defaults are client-side presets.';
COMMENT ON COLUMN public.project_decision_categories.color IS
  'Theme-token key resolved by CATEGORY_ACCENT in web. Never a hex value.';

-- Case-insensitive: "Technical" and "technical" are the same category, and
-- letting both exist splits the counts on the filter row for no reason.
CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_categories_name
  ON public.project_decision_categories (project_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_decision_categories_project
  ON public.project_decision_categories (project_id, position);

ALTER TABLE public.project_decision_categories ENABLE ROW LEVEL SECURITY;

-- Mirrors project_decisions: member SELECT only. Writes go through the service
-- role, because the real gate is a resolved role/origin/capability check that is
-- not expressible as an RLS predicate.
DROP POLICY IF EXISTS "Project members can view decision categories"
  ON public.project_decision_categories;
CREATE POLICY "Project members can view decision categories"
  ON public.project_decision_categories
  FOR SELECT
  USING (public.project_chat_is_member(project_id, auth.uid()));

-- ─── project_decisions gains a category and a human reference ───────────────

ALTER TABLE public.project_decisions
  -- SET NULL rather than RESTRICT: deleting a category must not be blocked by
  -- history. Affected decisions fall back to "Uncategorised", and the delete
  -- confirmation in web says how many that will be.
  ADD COLUMN IF NOT EXISTS category_id uuid
    REFERENCES public.project_decision_categories(id) ON DELETE SET NULL,
  -- Per-project human reference, DEC-024 style. Mirrors
  -- project_change_requests.reference, including its allocation strategy.
  ADD COLUMN IF NOT EXISTS reference integer;

CREATE INDEX IF NOT EXISTS idx_project_decisions_category
  ON public.project_decisions (category_id)
  WHERE category_id IS NOT NULL;

-- Backfill existing rows in decision order so the numbering reads as a history
-- rather than an insertion accident.
WITH numbered AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY project_id
      ORDER BY decided_on, created_at, id
    ) AS seq
  FROM public.project_decisions
  WHERE reference IS NULL
)
UPDATE public.project_decisions AS d
SET reference = numbered.seq
FROM numbered
WHERE d.id = numbered.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_decision_reference
  ON public.project_decisions (project_id, reference)
  WHERE reference IS NOT NULL;

COMMIT;
