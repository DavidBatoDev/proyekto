-- Allow metadata-only attachments (no actual file upload)
ALTER TABLE task_attachments ALTER COLUMN file_url DROP NOT NULL;
