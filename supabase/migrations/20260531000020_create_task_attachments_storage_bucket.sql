-- Create the task_attachments Supabase Storage bucket and its RLS policies.
-- The bucket is public so uploaded files can be accessed via public URL.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('task_attachments', 'task_attachments', true, 26214400)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload task attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'task_attachments');

CREATE POLICY "Anyone can view task attachments"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'task_attachments');

CREATE POLICY "Uploaders can delete their own task attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'task_attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
