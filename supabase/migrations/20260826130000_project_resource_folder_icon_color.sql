-- Resource folders: per-folder icon + accent colour.
-- Both are short tokens (not hex): the web maps them onto lucide icons and the
-- Tailwind palette, so the DB only guards shape and length. The defaults are a
-- plain folder icon and no accent colour, which is how folders looked before.

ALTER TABLE public.project_resource_folders
  ADD COLUMN IF NOT EXISTS icon text NOT NULL DEFAULT 'folder',
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT 'white';

ALTER TABLE public.project_resource_folders
  DROP CONSTRAINT IF EXISTS project_resource_folders_icon_token;
ALTER TABLE public.project_resource_folders
  ADD CONSTRAINT project_resource_folders_icon_token
  CHECK (icon ~ '^[a-z0-9-]{1,32}$');

ALTER TABLE public.project_resource_folders
  DROP CONSTRAINT IF EXISTS project_resource_folders_color_token;
ALTER TABLE public.project_resource_folders
  ADD CONSTRAINT project_resource_folders_color_token
  CHECK (color ~ '^[a-z0-9-]{1,32}$');

COMMENT ON COLUMN public.project_resource_folders.icon IS
  'Lucide icon token (see web resource folder icon map); defaults to folder.';
COMMENT ON COLUMN public.project_resource_folders.color IS
  'Accent colour token (Tailwind palette name) used for the folder card top border.';
