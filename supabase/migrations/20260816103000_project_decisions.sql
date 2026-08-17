-- Phase 5 of the project workspace IA: Decisions.
--
-- A decision log: what was decided, by whom, why, and what it replaced. The
-- supersede chain follows the contracts precedent
-- (contracts.supersedes_contract_id + version) rather than mutating rows, so
-- "why did we do X" stays answerable after the answer changes.
--
-- No new permission gate: reading is open to any project member, and writing
-- reuses project.edit_content. This is the smallest of the four surfaces and
-- the most likely to end up as an Overview panel plus a "log this decision"
-- action on a chat message — source_chat_message_id exists for exactly that.
--
-- The FK target is chat_room_messages. `chat_messages` was dropped 2026-03-27
-- and does not exist.

BEGIN;

CREATE TABLE IF NOT EXISTS public.project_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  -- What prompted the decision.
  context text,
  -- The decision itself, stated plainly.
  decision text NOT NULL,
  rationale text,
  alternatives_considered text,
  decided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_on date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'final',
  supersedes_decision_id uuid
    REFERENCES public.project_decisions(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  -- Set when the decision was captured from a chat message.
  source_chat_message_id uuid
    REFERENCES public.chat_room_messages(id) ON DELETE SET NULL,
  visibility text NOT NULL DEFAULT 'shared',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_decisions_title_not_blank
    CHECK (length(btrim(title)) > 0),
  CONSTRAINT project_decisions_decision_not_blank
    CHECK (length(btrim(decision)) > 0),
  CONSTRAINT project_decisions_status_check
    CHECK (status IN ('final', 'superseded')),
  CONSTRAINT project_decisions_visibility_check
    CHECK (visibility IN ('internal', 'shared')),
  CONSTRAINT project_decisions_no_self_supersede
    CHECK (supersedes_decision_id IS NULL OR supersedes_decision_id <> id)
);

COMMENT ON TABLE public.project_decisions IS
  'Project decision log. Superseding creates a new row pointing back, rather than editing history.';
COMMENT ON COLUMN public.project_decisions.supersedes_decision_id IS
  'The decision this one replaces. That row should be moved to status=superseded in the same write.';

-- A given decision can only be replaced once; a second replacement should
-- chain off the replacement instead.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_decisions_supersedes_once
  ON public.project_decisions (supersedes_decision_id)
  WHERE supersedes_decision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_decisions_project_decided
  ON public.project_decisions (project_id, decided_on DESC, created_at DESC);

ALTER TABLE public.project_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Project members can view decisions"
  ON public.project_decisions;
CREATE POLICY "Project members can view decisions"
  ON public.project_decisions
  FOR SELECT
  USING (public.project_chat_is_member(project_id, auth.uid()));

COMMIT;
