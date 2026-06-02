-- Fix FK constraints that blocked auth user deletion from the Supabase dashboard.
-- All of these blocked the profile → auth.users cascade chain.

-- 1. teams.owner_id: was RESTRICT, now CASCADE (deleting a user deletes their teams)
ALTER TABLE public.teams
  DROP CONSTRAINT teams_owner_id_fkey,
  ADD CONSTRAINT teams_owner_id_fkey
    FOREIGN KEY (owner_id)
    REFERENCES public.profiles(id)
    ON DELETE CASCADE;

-- 2. project_teams.team_id: was RESTRICT, now CASCADE (deleting a team removes attachment)
ALTER TABLE public.project_teams
  DROP CONSTRAINT project_teams_team_id_fkey,
  ADD CONSTRAINT project_teams_team_id_fkey
    FOREIGN KEY (team_id)
    REFERENCES public.teams(id)
    ON DELETE CASCADE;

-- 3. task_activity_log.changed_by: relax NOT NULL + set FK to SET NULL so audit rows
--    survive user deletion with a NULL actor instead of blocking the delete.
ALTER TABLE public.task_activity_log
  ALTER COLUMN changed_by DROP NOT NULL,
  DROP CONSTRAINT task_activity_log_changed_by_fkey,
  ADD CONSTRAINT task_activity_log_changed_by_fkey
    FOREIGN KEY (changed_by)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL;

-- 4. task_dependencies.created_by: same treatment
ALTER TABLE public.task_dependencies
  ALTER COLUMN created_by DROP NOT NULL,
  DROP CONSTRAINT task_dependencies_created_by_fkey,
  ADD CONSTRAINT task_dependencies_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL;
