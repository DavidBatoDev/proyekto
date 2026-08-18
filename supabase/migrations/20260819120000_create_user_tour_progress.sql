-- Per-user product tour progress.
--
-- Replaces the "one JSONB flag on profiles" approach: tours multiply over time
-- and some of them are scoped to a specific project/roadmap/team, which a blob
-- can neither index nor update without a read-modify-write race across tabs.
--
-- One row per (user, tour, scope). A row's existence means "this user has
-- already been through this tour" — that is what suppresses the auto-run.
-- Replaying does NOT delete the row: it bumps replay_count and leaves
-- status/completed_at intact, so the auto-run stays suppressed and we keep the
-- signal of how often a tour gets re-watched.
--
-- scope_id is deliberately NOT a foreign key: it is polymorphic across
-- projects, roadmaps and teams. Orphan rows after a project delete are
-- harmless (they only ever suppress a tour for a scope that no longer exists).
--
-- The web client reads and writes these rows directly under the own-row RLS
-- policies below, the same way it reads public.profiles.

CREATE TABLE IF NOT EXISTS public.user_tour_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tour_key text NOT NULL,
  scope_type text NOT NULL DEFAULT 'global'
    CHECK (scope_type IN ('global', 'project', 'roadmap', 'team')),
  scope_id uuid,
  status text NOT NULL CHECK (status IN ('completed', 'skipped')),
  last_step integer NOT NULL DEFAULT 0 CHECK (last_step >= 0),
  replay_count integer NOT NULL DEFAULT 0 CHECK (replay_count >= 0),
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A global tour has no scope target; a scoped tour must name one.
  CONSTRAINT user_tour_progress_scope_shape_check
    CHECK ((scope_type = 'global') = (scope_id IS NULL))
);

-- NULLS NOT DISTINCT (PG15+; this project is PG17) so global rows, whose
-- scope_id is NULL, still collide and `upsert ... on conflict` works for them.
CREATE UNIQUE INDEX IF NOT EXISTS user_tour_progress_unique_scope
  ON public.user_tour_progress (user_id, tour_key, scope_type, scope_id)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_user_tour_progress_user_tour
  ON public.user_tour_progress (user_id, tour_key);

CREATE OR REPLACE FUNCTION public.handle_user_tour_progress_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_tour_progress_updated_at
  ON public.user_tour_progress;
CREATE TRIGGER trg_user_tour_progress_updated_at
BEFORE UPDATE ON public.user_tour_progress
FOR EACH ROW
EXECUTE FUNCTION public.handle_user_tour_progress_updated_at();

ALTER TABLE public.user_tour_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own tour progress"
ON public.user_tour_progress;
CREATE POLICY "Users can view their own tour progress"
ON public.user_tour_progress
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own tour progress"
ON public.user_tour_progress;
CREATE POLICY "Users can insert their own tour progress"
ON public.user_tour_progress
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own tour progress"
ON public.user_tour_progress;
CREATE POLICY "Users can update their own tour progress"
ON public.user_tour_progress
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own tour progress"
ON public.user_tour_progress;
CREATE POLICY "Users can delete their own tour progress"
ON public.user_tour_progress
FOR DELETE
USING (auth.uid() = user_id);

COMMENT ON TABLE public.user_tour_progress IS
  'One row per (user, tour_key, scope). Row presence suppresses a tour auto-run; replays bump replay_count instead of deleting.';
