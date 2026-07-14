-- Restrict Public Link Access
-- Migration: 20260213135210_restrict_public_link_access.sql
-- Date: February 13, 2026
-- Description: Adds CHECK constraint to prevent editor access via public links

-- Update any existing roadmap_shares that have 'editor' as default_role to 'viewer'
UPDATE roadmap_shares 
SET default_role = 'viewer' 
WHERE default_role = 'editor';

-- Add CHECK constraint to prevent default_role from being 'editor'
-- Public links should only allow 'viewer' or 'commenter' access for security
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_default_role_not_editor'
      AND conrelid = 'public.roadmap_shares'::regclass
  ) THEN
    ALTER TABLE roadmap_shares
      ADD CONSTRAINT check_default_role_not_editor
      CHECK (default_role IN ('viewer', 'commenter'));
  END IF;
END;
$$;
