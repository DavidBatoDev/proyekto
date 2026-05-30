-- Task Activity Log: tracks key field changes on roadmap_tasks
CREATE TABLE task_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES roadmap_tasks(id) ON DELETE CASCADE,
  changed_by UUID NOT NULL REFERENCES profiles(id),
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_activity_log_task_id ON task_activity_log(task_id);
CREATE INDEX idx_task_activity_log_created_at ON task_activity_log(created_at DESC);

ALTER TABLE task_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view task activity"
  ON task_activity_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert task activity"
  ON task_activity_log FOR INSERT
  TO service_role
  WITH CHECK (true);
