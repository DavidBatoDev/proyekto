-- Enable Supabase Realtime postgres_changes for roadmap collaboration tables.
-- Without this, client-side postgres_changes subscriptions silently receive no
-- events even though the Supabase Realtime connection itself is healthy (which
-- is why cursor broadcast/presence worked while data sync did not).
--
-- REPLICA IDENTITY FULL is required so that:
--   1. Filtered DELETE subscriptions receive the old row values to match against
--   2. UPDATE events surface the previous column values when needed

ALTER TABLE roadmap_epics      REPLICA IDENTITY FULL;
ALTER TABLE roadmap_features   REPLICA IDENTITY FULL;
ALTER TABLE roadmap_milestones REPLICA IDENTITY FULL;
ALTER TABLE roadmap_tasks      REPLICA IDENTITY FULL;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roadmap_epics','roadmap_features','roadmap_milestones','roadmap_tasks']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END $$;
