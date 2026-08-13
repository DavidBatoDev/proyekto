-- Dedicated production QA fixtures.
--
-- The registry is deliberately service-role only. It identifies synthetic
-- commercial graphs for cleanup and outbound-action safety; it is never an
-- authorization source.

BEGIN;

CREATE TABLE public.qa_fixtures (
  key text PRIMARY KEY,
  project_id uuid NOT NULL UNIQUE
    REFERENCES public.projects(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL UNIQUE
    REFERENCES public.contracts(id) ON DELETE RESTRICT,
  consultant_user_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  worker_user_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  client_user_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE RESTRICT,
  primary_team_id uuid NOT NULL UNIQUE
    REFERENCES public.teams(id) ON DELETE RESTRICT,
  secondary_team_id uuid NOT NULL UNIQUE
    REFERENCES public.teams(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_reset_at timestamptz,
  last_success_at timestamptz,
  CONSTRAINT qa_fixtures_key_format
    CHECK (key ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  CONSTRAINT qa_fixtures_distinct_users
    CHECK (
      consultant_user_id <> worker_user_id
      AND consultant_user_id <> client_user_id
      AND worker_user_id <> client_user_id
    ),
  CONSTRAINT qa_fixtures_distinct_teams
    CHECK (primary_team_id <> secondary_team_id)
);

COMMENT ON TABLE public.qa_fixtures IS
  'Service-role-only registry of synthetic production QA graphs. Never grants project access.';

ALTER TABLE public.qa_fixtures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qa_fixtures FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.qa_fixtures TO service_role;

CREATE OR REPLACE FUNCTION public.reset_qa_fixture(
  p_key text,
  p_mark_success boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fixture public.qa_fixtures%ROWTYPE;
BEGIN
  SELECT * INTO v_fixture
  FROM public.qa_fixtures
  WHERE key = p_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QA_FIXTURE_NOT_FOUND';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = v_fixture.project_id
      AND p.title LIKE '[QA]%'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.id = v_fixture.contract_id
      AND c.project_id = v_fixture.project_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.project_teams pt
    WHERE pt.project_id = v_fixture.project_id
      AND pt.team_id = v_fixture.primary_team_id
      AND pt.is_primary IS TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM public.project_teams pt
    WHERE pt.project_id = v_fixture.project_id
      AND pt.team_id = v_fixture.secondary_team_id
  ) THEN
    RAISE EXCEPTION 'QA_FIXTURE_CORE_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.project_id = v_fixture.project_id
      AND i.status <> 'draft'
  ) THEN
    RAISE EXCEPTION 'QA_FIXTURE_HAS_NON_DRAFT_INVOICE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.task_time_logs l
    WHERE l.project_id = v_fixture.project_id
      AND (l.status = 'paid' OR l.payout_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'QA_FIXTURE_HAS_PAID_LOG';
  END IF;

  DELETE FROM public.invoices
  WHERE project_id = v_fixture.project_id
    AND status = 'draft';

  DELETE FROM public.task_time_logs
  WHERE project_id = v_fixture.project_id
    AND payout_id IS NULL
    AND status <> 'paid';

  DELETE FROM public.notifications
  WHERE project_id = v_fixture.project_id
    AND user_id IN (
      v_fixture.consultant_user_id,
      v_fixture.worker_user_id,
      v_fixture.client_user_id
    );

  UPDATE public.teams
  SET time_tracking_enabled = true,
      updated_at = now()
  WHERE id IN (v_fixture.primary_team_id, v_fixture.secondary_team_id);

  UPDATE public.qa_fixtures
  SET last_reset_at = now(),
      last_success_at = CASE
        WHEN p_mark_success THEN now()
        ELSE last_success_at
      END
  WHERE key = p_key;

  RETURN jsonb_build_object(
    'key', v_fixture.key,
    'project_id', v_fixture.project_id,
    'contract_id', v_fixture.contract_id,
    'consultant_user_id', v_fixture.consultant_user_id,
    'worker_user_id', v_fixture.worker_user_id,
    'client_user_id', v_fixture.client_user_id,
    'primary_team_id', v_fixture.primary_team_id,
    'secondary_team_id', v_fixture.secondary_team_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reset_qa_fixture(text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_qa_fixture(text, boolean) TO service_role;

COMMIT;
