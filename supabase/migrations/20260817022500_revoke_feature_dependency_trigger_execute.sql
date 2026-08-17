-- Take prevent_feature_dependency_cycle() off the public RPC surface.
--
-- Supabase's linter flagged it (0028/0029): a SECURITY DEFINER function in the
-- public schema is reachable by anon and authenticated at
-- /rest/v1/rpc/prevent_feature_dependency_cycle.
--
-- It has to stay SECURITY DEFINER — the recursive cycle walk must see every
-- edge in the roadmap, and under SECURITY INVOKER, RLS could hide an edge from
-- the caller and let a cycle slip through the check.
--
-- Revoking EXECUTE does not affect the trigger. Postgres checks the TRIGGER
-- privilege on the table when the trigger is created; firing it does not
-- require EXECUTE on the function.
REVOKE ALL ON FUNCTION public.prevent_feature_dependency_cycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_feature_dependency_cycle() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_feature_dependency_cycle() FROM authenticated;
