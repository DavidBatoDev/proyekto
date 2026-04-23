-- Stores per-project role permission overrides so the Roles & Permissions
-- editor can reload saved state rather than always showing the hardcoded defaults.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS role_permissions_json JSONB NOT NULL DEFAULT '{}'::jsonb;
