-- Assert and register the production QA schema after an environment repair.
-- This is intentionally non-mutating: it fails closed if the fixture objects
-- or their access controls are incomplete.

DO $$
DECLARE
  v_rls_enabled boolean;
BEGIN
  IF to_regclass('public.qa_fixtures') IS NULL THEN
    RAISE EXCEPTION 'QA_FIXTURE_TABLE_MISSING';
  END IF;

  IF to_regprocedure('public.reset_qa_fixture(text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'QA_FIXTURE_RESET_RPC_MISSING';
  END IF;

  SELECT c.relrowsecurity
  INTO v_rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'qa_fixtures';

  IF v_rls_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'QA_FIXTURE_RLS_DISABLED';
  END IF;

  IF has_table_privilege('anon', 'public.qa_fixtures', 'SELECT')
    OR has_table_privilege('authenticated', 'public.qa_fixtures', 'SELECT')
  THEN
    RAISE EXCEPTION 'QA_FIXTURE_TABLE_EXPOSED';
  END IF;

  IF NOT has_table_privilege(
    'service_role',
    'public.qa_fixtures',
    'SELECT'
  ) THEN
    RAISE EXCEPTION 'QA_FIXTURE_SERVICE_ROLE_TABLE_ACCESS_MISSING';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.reset_qa_fixture(text,boolean)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.reset_qa_fixture(text,boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'QA_FIXTURE_RESET_RPC_EXPOSED';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.reset_qa_fixture(text,boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'QA_FIXTURE_SERVICE_ROLE_RPC_ACCESS_MISSING';
  END IF;
END;
$$;
