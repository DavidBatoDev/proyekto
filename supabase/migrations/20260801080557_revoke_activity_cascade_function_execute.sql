-- 20260801080313_roadmap_activity_cascade.sql created 6 SECURITY DEFINER
-- trigger functions in the public schema. get_advisors flagged all of them
-- as WARN (anon_security_definer_function_executable /
-- authenticated_security_definer_function_executable): PostgREST exposes
-- every public-schema function at /rest/v1/rpc/<name>, so anon/authenticated
-- roles could otherwise call them directly.
--
-- These are pure trigger functions (RETURNS trigger) - Postgres invokes them
-- automatically as part of the owning table's DML, which does not require
-- the invoking role to hold EXECUTE on the function. Revoking EXECUTE here
-- only blocks direct RPC calls; the activity-cascade triggers keep firing
-- normally. Same remediation pattern as
-- 20260701000030_harden_payout_functions.sql.

REVOKE EXECUTE ON FUNCTION public.touch_parent_roadmap_updated_at()
  FROM public, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.touch_roadmap_from_task_change()
  FROM public, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.touch_roadmap_from_task_comment()
  FROM public, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.touch_roadmap_from_epic_comment()
  FROM public, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.touch_roadmap_from_feature_comment()
  FROM public, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.touch_project_from_roadmap()
  FROM public, anon, authenticated;
