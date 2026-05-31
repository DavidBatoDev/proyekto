-- Enable Supabase Realtime postgres_changes for roadmap collaboration tables.
-- Without this, client-side postgres_changes subscriptions silently receive no
-- events even though the Supabase Realtime connection itself is healthy (which
-- is why cursor broadcast/presence worked while data sync did not).
--
-- REPLICA IDENTITY FULL is required so that:
--   1. Filtered DELETE subscriptions receive the old row values to match against
--   2. UPDATE events surface the previous column values when needed

ALTER TABLE roadmap_epics     REPLICA IDENTITY FULL;
ALTER TABLE roadmap_features  REPLICA IDENTITY FULL;
ALTER TABLE roadmap_milestones REPLICA IDENTITY FULL;
ALTER TABLE roadmap_tasks     REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE roadmap_epics;
ALTER PUBLICATION supabase_realtime ADD TABLE roadmap_features;
ALTER PUBLICATION supabase_realtime ADD TABLE roadmap_milestones;
ALTER PUBLICATION supabase_realtime ADD TABLE roadmap_tasks;
