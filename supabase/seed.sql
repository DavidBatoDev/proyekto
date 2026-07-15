-- Local reset data. The canonical data lives in restricted migration
-- functions so local and deployed environments cannot drift.
SELECT public.seed_builtin_roadmap_templates();
SELECT public.seed_additional_builtin_roadmap_templates();
SELECT public.seed_third_builtin_roadmap_templates();
SELECT public.seed_curated_roadmap_template_batches();
