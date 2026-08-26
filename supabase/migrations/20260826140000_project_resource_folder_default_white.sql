-- Resource folders default to no accent (white) rather than slate.
-- Folders still sitting on the old default are moved across; anything a user
-- deliberately coloured slate is left alone only in the sense that this runs
-- once, right after the column shipped, before slate was a real choice.

ALTER TABLE public.project_resource_folders
  ALTER COLUMN color SET DEFAULT 'white';

UPDATE public.project_resource_folders
SET color = 'white'
WHERE color = 'slate';
