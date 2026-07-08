-- Migration: Add banner_url to projects + project_banners storage bucket
-- Date: 2026-03-03
-- Description: Adds project banner image support

-- 1. Add banner_url column to projects table
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS banner_url text;

-- 2. Create the project_banners storage bucket (run in Supabase Dashboard → Storage,
--    or execute if your setup supports storage SQL):
--
--    INSERT INTO storage.buckets (id, name, public)
--    VALUES ('project_banners', 'project_banners', true)
--    ON CONFLICT (id) DO NOTHING;

-- 3. Storage RLS Policies (run in Supabase Dashboard → Storage → Policies → project_banners)
--
--    Policy: Allow authenticated users to upload
--    CREATE POLICY "Allow auth upload to project_banners"
--      ON storage.objects FOR INSERT
--      TO authenticated
--      WITH CHECK (bucket_id = 'project_banners');
--
--    Policy: Allow public read
--    CREATE POLICY "Public read project_banners"
--      ON storage.objects FOR SELECT
--      TO public
--      USING (bucket_id = 'project_banners');
--
--    Policy: Allow authenticated users to update (overwrite)
--    CREATE POLICY "Allow auth update project_banners"
--      ON storage.objects FOR UPDATE
--      TO authenticated
--      USING (bucket_id = 'project_banners');
