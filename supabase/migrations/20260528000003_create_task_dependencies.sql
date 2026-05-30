-- Task Dependencies: tracks blocker relationships between tasks
CREATE TABLE task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocking_task_id UUID NOT NULL REFERENCES roadmap_tasks(id) ON DELETE CASCADE,
  blocked_task_id UUID NOT NULL REFERENCES roadmap_tasks(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(blocking_task_id, blocked_task_id),
  CHECK (blocking_task_id <> blocked_task_id)
);

CREATE INDEX idx_task_deps_blocking ON task_dependencies(blocking_task_id);
CREATE INDEX idx_task_deps_blocked ON task_dependencies(blocked_task_id);

ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view task dependencies"
  ON task_dependencies FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role manages task dependencies"
  ON task_dependencies FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
