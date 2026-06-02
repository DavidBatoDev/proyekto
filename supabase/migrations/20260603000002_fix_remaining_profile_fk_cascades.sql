-- Fix all remaining FK constraints that block auth user deletion from the dashboard.
-- Nullable audit/attribution columns get ON DELETE SET NULL.
-- invoices.issuer_user_id is relaxed to nullable + SET NULL so invoices survive user deletion.

-- project_access.granted_by (table was renamed from project_shares)
ALTER TABLE public.project_access
  DROP CONSTRAINT IF EXISTS project_access_granted_by_fkey,
  ADD CONSTRAINT project_access_granted_by_fkey
    FOREIGN KEY (granted_by)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL;

-- project_teams.attached_by
ALTER TABLE public.project_teams
  DROP CONSTRAINT IF EXISTS project_teams_attached_by_fkey,
  ADD CONSTRAINT project_teams_attached_by_fkey
    FOREIGN KEY (attached_by)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL;

-- project_team_members.added_by
ALTER TABLE public.project_team_members
  DROP CONSTRAINT IF EXISTS project_team_members_added_by_fkey,
  ADD CONSTRAINT project_team_members_added_by_fkey
    FOREIGN KEY (added_by)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL;

-- consultant_applications.reviewed_by
ALTER TABLE public.consultant_applications
  DROP CONSTRAINT IF EXISTS consultant_applications_reviewed_by_fkey,
  ADD CONSTRAINT consultant_applications_reviewed_by_fkey
    FOREIGN KEY (reviewed_by)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL;

-- invoices.issuer_user_id — relax NOT NULL so invoice record survives user deletion
ALTER TABLE public.invoices
  ALTER COLUMN issuer_user_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS invoices_issuer_user_id_fkey,
  ADD CONSTRAINT invoices_issuer_user_id_fkey
    FOREIGN KEY (issuer_user_id)
    REFERENCES public.profiles(id)
    ON DELETE SET NULL;
