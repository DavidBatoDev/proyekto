UPDATE storage.buckets
SET file_size_limit = 5242880
WHERE id = 'task_attachments';
