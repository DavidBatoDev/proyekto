-- Rewrite stored Supabase Storage URLs to the Cloudflare R2 custom domain.
--
-- Context: file assets have been copied from Supabase Storage to R2 (public
-- bucket served at https://cdn.proyekto.tech, private bucket for identity docs).
-- Existing rows still hold Supabase public URLs of the form:
--   https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path>
-- The new R2 key keeps `<bucket>/` as its prefix, so we map a stored URL to the
-- R2 host by taking everything after the `/object/public/` marker. This is
-- host-agnostic (no project-ref literal) and idempotent: a second run finds no
-- `/object/public/` marker on already-rewritten cdn URLs and is a no-op.
--
-- IMPORTANT: run this ONLY after the rclone copy has completed for every bucket.

begin;

-- Public buckets -> custom domain. Single host-prefix swap, preserving
-- `<bucket>/<path>` (split_part(..., 2) returns the text after the marker).
update public.profiles
set avatar_url =
  'https://cdn.proyekto.tech/' || split_part(avatar_url, '/object/public/', 2)
where avatar_url like '%/object/public/%';

update public.profiles
set banner_url =
  'https://cdn.proyekto.tech/' || split_part(banner_url, '/object/public/', 2)
where banner_url like '%/object/public/%';

update public.projects
set banner_url =
  'https://cdn.proyekto.tech/' || split_part(banner_url, '/object/public/', 2)
where banner_url like '%/object/public/%';

update public.user_portfolios
set image_url =
  'https://cdn.proyekto.tech/' || split_part(image_url, '/object/public/', 2)
where image_url like '%/object/public/%';

update public.roadmaps
set preview_url =
  'https://cdn.proyekto.tech/' || split_part(preview_url, '/object/public/', 2)
where preview_url like '%/object/public/%';

update public.task_attachments
set file_url =
  'https://cdn.proyekto.tech/' || split_part(file_url, '/object/public/', 2)
where file_url like '%/object/public/%';

-- Private bucket (identity documents). These rows currently store a full
-- (non-working) public-style URL; normalize to the bare R2 key so future reads
-- can issue a presigned GET. Handle both `/object/public/` and `/object/sign/`.
update public.user_identity_documents
set storage_path = split_part(storage_path, '/object/public/', 2)
where storage_path like '%/object/public/%';

update public.user_identity_documents
set storage_path = split_part(storage_path, '/object/sign/', 2)
where storage_path like '%/object/sign/%';

commit;
