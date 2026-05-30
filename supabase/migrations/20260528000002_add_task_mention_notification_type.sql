-- Add notification type for task comment @mentions
INSERT INTO notification_types (name, category, priority)
VALUES ('task_comment_mention', 'specific', 'medium')
ON CONFLICT (name) DO NOTHING;
