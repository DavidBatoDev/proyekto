-- Local reset data. The canonical data lives in the restricted migration
-- function so local and deployed environments cannot drift.
SELECT public.seed_builtin_roadmap_templates();
