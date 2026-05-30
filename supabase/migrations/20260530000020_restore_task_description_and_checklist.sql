-- Migration: 20260530000020_restore_task_description_and_checklist.sql
-- Date: May 30, 2026
-- Description:
--   Restores description and checklist columns to roadmap_tasks, which were
--   dropped in 20260209000000_remove_unused_task_fields.sql but are now
--   required for the task side panel (description editor + checklist feature).

ALTER TABLE public.roadmap_tasks
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS checklist JSONB DEFAULT '[]'::jsonb;
