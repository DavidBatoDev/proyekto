-- Migration: 20261001120000_revoke_contracts_record_revision_execute.sql
-- Date: October 1, 2026
-- Description:
--   public.contracts_record_revision() (20260930100000_contract_authoring_history)
--   is a SECURITY DEFINER trigger function. Functions are created with EXECUTE
--   granted to PUBLIC, so the Supabase advisor flags it as callable by anon and
--   authenticated via /rest/v1/rpc. A trigger function cannot actually run
--   outside a trigger, but it should not be exposed at all. The trigger
--   (trg_contracts_record_revision) fires under the table owner, so revoking
--   EXECUTE from these roles does not affect it.
--
--   Same pattern as 20260801080557_revoke_activity_cascade_function_execute.
--   Additive and idempotent. NOT APPLIED to PROD: awaiting August's approval.

REVOKE EXECUTE ON FUNCTION public.contracts_record_revision() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contracts_record_revision() TO service_role;
