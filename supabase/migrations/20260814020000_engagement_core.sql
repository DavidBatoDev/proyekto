-- P4b expand: durable commercial engagements and position-based contracts.
--
-- This migration is deliberately backend-dark. It creates the target schema
-- without changing the current contract, invoice, payout, or time-log write
-- paths. Existing contracts receive deterministic relationship/scope defaults,
-- but no engagement or contract-position rows are fabricated. A later backend
-- cutover creates engagements only when a new root contract is fully signed.
--
-- Engagements never authorize execution access: project_access remains the
-- sole project authorization source. New tables are service-role only under
-- RLS until role-specific, redacted API projections ship.

BEGIN;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS relationship_kind text NOT NULL DEFAULT 'client_services',
  ADD COLUMN IF NOT EXISTS scope_mode text NOT NULL DEFAULT 'project_specific',
  ADD COLUMN IF NOT EXISTS contract_family_id uuid;

ALTER TABLE public.contracts
  DROP CONSTRAINT IF EXISTS contracts_relationship_kind_check,
  ADD CONSTRAINT contracts_relationship_kind_check
    CHECK (relationship_kind IN ('client_services', 'talent_services')),
  DROP CONSTRAINT IF EXISTS contracts_scope_mode_check,
  ADD CONSTRAINT contracts_scope_mode_check
    CHECK (scope_mode IN ('project_specific', 'flexible'));

COMMENT ON COLUMN public.contracts.relationship_kind IS
  'Commercial direction: client_services means client hires consultant; talent_services means consultant hires talent.';
COMMENT ON COLUMN public.contracts.scope_mode IS
  'project_specific binds the agreement to one project; flexible permits zero or many later project links. A null project on project_specific remains a severed-project marker.';
COMMENT ON COLUMN public.contracts.contract_family_id IS
  'Stable family shared by a root contract and its amendments. Null denotes a legacy contract outside the P4b engagement workflow.';

CREATE TABLE public.engagements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  scope_mode text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  origin text NOT NULL DEFAULT 'contract',
  activated_by_contract_id uuid REFERENCES public.contracts(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  cancelled_at timestamptz,
  status_reason text,
  status_changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagements_kind_check
    CHECK (kind IN ('client_services', 'talent_services')),
  CONSTRAINT engagements_scope_mode_check
    CHECK (scope_mode IN ('project_specific', 'flexible')),
  CONSTRAINT engagements_status_check
    CHECK (status IN ('active', 'ended', 'cancelled')),
  CONSTRAINT engagements_origin_check
    CHECK (origin IN ('contract', 'legacy')),
  CONSTRAINT engagements_contract_origin_check
    CHECK (origin <> 'contract' OR activated_by_contract_id IS NOT NULL),
  CONSTRAINT engagements_terminal_timestamp_check
    CHECK (
      (status = 'active' AND ended_at IS NULL AND cancelled_at IS NULL)
      OR (status = 'ended' AND ended_at IS NOT NULL AND cancelled_at IS NULL)
      OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
    )
);

CREATE INDEX idx_engagements_status_kind
  ON public.engagements(status, kind, started_at DESC);
CREATE INDEX idx_engagements_activating_contract
  ON public.engagements(activated_by_contract_id)
  WHERE activated_by_contract_id IS NOT NULL;

COMMENT ON TABLE public.engagements IS
  'Durable bilateral commercial relationship created by a fully signed root contract. It may be project-specific or flexible and is never an execution authorization grant.';

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS engagement_id uuid;

ALTER TABLE public.contracts
  DROP CONSTRAINT IF EXISTS contracts_engagement_id_fkey,
  ADD CONSTRAINT contracts_engagement_id_fkey
    FOREIGN KEY (engagement_id)
    REFERENCES public.engagements(id)
    ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_contracts_engagement_version
  ON public.contracts(engagement_id, version DESC)
  WHERE engagement_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contracts_family_version
  ON public.contracts(contract_family_id, version)
  WHERE contract_family_id IS NOT NULL;

COMMENT ON COLUMN public.contracts.engagement_id IS
  'Commercial relationship governed by this contract version. Null means an unsigned root contract or a legacy contract outside P4b.';

CREATE TABLE public.engagement_parties (
  engagement_id uuid NOT NULL REFERENCES public.engagements(id) ON DELETE RESTRICT,
  position text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  capacity text NOT NULL,
  display_name_snapshot text NOT NULL,
  email_snapshot text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (engagement_id, position),
  CONSTRAINT engagement_parties_position_check
    CHECK (position IN ('hirer', 'provider')),
  CONSTRAINT engagement_parties_capacity_check
    CHECK (capacity IN ('client', 'consultant', 'talent')),
  CONSTRAINT engagement_parties_no_self_dealing
    UNIQUE (engagement_id, user_id)
);

CREATE INDEX idx_engagement_parties_user
  ON public.engagement_parties(user_id, engagement_id);

COMMENT ON TABLE public.engagement_parties IS
  'Immutable hirer/provider seats. Capacity is contextual to this engagement, not an account-level role.';

CREATE TABLE public.engagement_project_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES public.engagements(id) ON DELETE RESTRICT,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  project_title_snapshot text NOT NULL,
  basis text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  linked_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  status_reason text,
  linked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_project_links_basis_check
    CHECK (basis IN ('contract_scope', 'operational_assignment')),
  CONSTRAINT engagement_project_links_status_check
    CHECK (status IN ('active', 'ended')),
  CONSTRAINT engagement_project_links_end_check
    CHECK (
      (status = 'active' AND ended_at IS NULL)
      OR (status = 'ended' AND ended_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_engagement_project_links_active
  ON public.engagement_project_links(engagement_id, project_id)
  WHERE status = 'active' AND project_id IS NOT NULL;
CREATE INDEX idx_engagement_project_links_project
  ON public.engagement_project_links(project_id, status)
  WHERE project_id IS NOT NULL;

COMMENT ON TABLE public.engagement_project_links IS
  'Durable record of where an engagement is legally scoped or operationally used. Project deletion severs only the FK; the title snapshot and link survive.';

CREATE TABLE public.engagement_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  project_title_snapshot text NOT NULL,
  worker_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  client_engagement_id uuid REFERENCES public.engagements(id) ON DELETE RESTRICT,
  talent_engagement_id uuid REFERENCES public.engagements(id) ON DELETE RESTRICT,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  team_name_snapshot text,
  role_title text,
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  status_reason text,
  assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engagement_assignments_context_check
    CHECK (client_engagement_id IS NOT NULL OR talent_engagement_id IS NOT NULL),
  CONSTRAINT engagement_assignments_status_check
    CHECK (status IN ('active', 'ended', 'cancelled')),
  CONSTRAINT engagement_assignments_window_check
    CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT engagement_assignments_terminal_check
    CHECK (
      (status = 'active' AND ended_at IS NULL)
      OR (status IN ('ended', 'cancelled') AND ended_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_engagement_assignments_active_exact
  ON public.engagement_assignments(
    worker_user_id,
    project_id,
    COALESCE(client_engagement_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(talent_engagement_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'active' AND project_id IS NOT NULL;
CREATE INDEX idx_engagement_assignments_worker_project
  ON public.engagement_assignments(worker_user_id, project_id, status);
CREATE INDEX idx_engagement_assignments_client_engagement
  ON public.engagement_assignments(client_engagement_id, status)
  WHERE client_engagement_id IS NOT NULL;
CREATE INDEX idx_engagement_assignments_talent_engagement
  ON public.engagement_assignments(talent_engagement_id, status)
  WHERE talent_engagement_id IS NOT NULL;

COMMENT ON TABLE public.engagement_assignments IS
  'Commercial attribution of one worker to one project. A client engagement identifies revenue context; a talent engagement identifies consultant-to-talent cost context. This table grants no project access.';

CREATE TABLE public.contract_positions (
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  position text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  capacity text NOT NULL,
  display_name_snapshot text NOT NULL,
  email_snapshot text,
  signer_name text,
  signature_url text,
  signature_scale numeric(6,3) NOT NULL DEFAULT 1,
  signature_offset_x numeric(8,4) NOT NULL DEFAULT 0,
  signature_offset_y numeric(8,4) NOT NULL DEFAULT 0,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, position),
  CONSTRAINT contract_positions_position_check
    CHECK (position IN ('hirer', 'provider')),
  CONSTRAINT contract_positions_capacity_check
    CHECK (capacity IN ('client', 'consultant', 'talent')),
  CONSTRAINT contract_positions_no_self_dealing
    UNIQUE (contract_id, user_id),
  CONSTRAINT contract_positions_signature_scale_check
    CHECK (signature_scale > 0)
);

CREATE INDEX idx_contract_positions_user
  ON public.contract_positions(user_id, contract_id);

COMMENT ON TABLE public.contract_positions IS
  'Target position-based contract seats and signatures. Empty for legacy contracts; existing consultant/client columns remain compatibility authority until a later backend cutover.';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS engagement_id uuid;
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_engagement_id_fkey,
  ADD CONSTRAINT invoices_engagement_id_fkey
    FOREIGN KEY (engagement_id)
    REFERENCES public.engagements(id)
    ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_invoices_engagement
  ON public.invoices(engagement_id, created_at DESC)
  WHERE engagement_id IS NOT NULL;
COMMENT ON COLUMN public.invoices.engagement_id IS
  'Client-services engagement billed by this invoice. Null retains the legacy project/contract billing path.';

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS engagement_id uuid;
ALTER TABLE public.payouts
  DROP CONSTRAINT IF EXISTS payouts_engagement_id_fkey,
  ADD CONSTRAINT payouts_engagement_id_fkey
    FOREIGN KEY (engagement_id)
    REFERENCES public.engagements(id)
    ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_payouts_engagement
  ON public.payouts(engagement_id, created_at DESC)
  WHERE engagement_id IS NOT NULL;
COMMENT ON COLUMN public.payouts.engagement_id IS
  'Talent-services engagement paid by this payout. Null retains the legacy team/member payout path.';

CREATE OR REPLACE FUNCTION public.tg_engagement_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_engagements_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ENGAGEMENT_DELETE_FORBIDDEN';
  END IF;

  IF NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.scope_mode IS DISTINCT FROM OLD.scope_mode
    OR NEW.origin IS DISTINCT FROM OLD.origin
    OR NEW.activated_by_contract_id IS DISTINCT FROM OLD.activated_by_contract_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'ENGAGEMENT_IDENTITY_IMMUTABLE';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
    AND NOT (OLD.status = 'active' AND NEW.status IN ('ended', 'cancelled')) THEN
    RAISE EXCEPTION 'ENGAGEMENT_STATUS_TRANSITION_INVALID';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_engagement_parties_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'ENGAGEMENT_PARTY_IMMUTABLE';
  END IF;

  SELECT kind INTO v_kind
  FROM public.engagements
  WHERE id = NEW.engagement_id;

  IF (v_kind = 'client_services' AND NOT (
      (NEW.position = 'hirer' AND NEW.capacity = 'client')
      OR (NEW.position = 'provider' AND NEW.capacity = 'consultant')
    ))
    OR (v_kind = 'talent_services' AND NOT (
      (NEW.position = 'hirer' AND NEW.capacity = 'consultant')
      OR (NEW.position = 'provider' AND NEW.capacity = 'talent')
    )) THEN
    RAISE EXCEPTION 'ENGAGEMENT_PARTY_CAPACITY_INVALID';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_engagement_require_parties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_engagement_id uuid;
BEGIN
  v_engagement_id := CASE WHEN TG_TABLE_NAME = 'engagements' THEN NEW.id ELSE NEW.engagement_id END;

  IF (SELECT count(*) FROM public.engagement_parties WHERE engagement_id = v_engagement_id) <> 2
    OR NOT EXISTS (
      SELECT 1 FROM public.engagement_parties
      WHERE engagement_id = v_engagement_id AND position = 'hirer'
    )
    OR NOT EXISTS (
      SELECT 1 FROM public.engagement_parties
      WHERE engagement_id = v_engagement_id AND position = 'provider'
    ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_REQUIRES_TWO_PARTIES';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_engagement_project_links_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ENGAGEMENT_PROJECT_LINK_DELETE_FORBIDDEN';
  END IF;

  IF NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
    OR NEW.basis IS DISTINCT FROM OLD.basis
    OR NEW.linked_by IS DISTINCT FROM OLD.linked_by
    OR NEW.project_title_snapshot IS DISTINCT FROM OLD.project_title_snapshot
    OR (
      NEW.project_id IS DISTINCT FROM OLD.project_id
      AND NOT (OLD.project_id IS NOT NULL AND NEW.project_id IS NULL)
    ) THEN
    RAISE EXCEPTION 'ENGAGEMENT_PROJECT_LINK_IDENTITY_IMMUTABLE';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
    AND NOT (OLD.status = 'active' AND NEW.status = 'ended') THEN
    RAISE EXCEPTION 'ENGAGEMENT_PROJECT_LINK_STATUS_INVALID';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_engagement_project_scope_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_engagement_id uuid;
  v_scope_mode text;
  v_engagement_status text;
  v_contract_scope_count integer;
BEGIN
  IF TG_TABLE_NAME = 'engagements' THEN
    v_engagement_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    v_engagement_id := OLD.engagement_id;
  ELSE
    v_engagement_id := NEW.engagement_id;
  END IF;

  SELECT scope_mode, status INTO v_scope_mode, v_engagement_status
  FROM public.engagements
  WHERE id = v_engagement_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_engagement_status <> 'active' THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_contract_scope_count
  FROM public.engagement_project_links
  WHERE engagement_id = v_engagement_id
    AND basis = 'contract_scope'
    AND status = 'active';

  IF v_scope_mode = 'project_specific' AND v_contract_scope_count <> 1 THEN
    RAISE EXCEPTION 'PROJECT_SPECIFIC_ENGAGEMENT_REQUIRES_ONE_SCOPE';
  END IF;
  IF v_scope_mode = 'flexible' AND v_contract_scope_count <> 0 THEN
    RAISE EXCEPTION 'FLEXIBLE_ENGAGEMENT_CANNOT_HAVE_CONTRACT_SCOPE';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_engagement_assignments_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ENGAGEMENT_ASSIGNMENT_DELETE_FORBIDDEN';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.worker_user_id IS DISTINCT FROM OLD.worker_user_id
      OR NEW.client_engagement_id IS DISTINCT FROM OLD.client_engagement_id
      OR NEW.talent_engagement_id IS DISTINCT FROM OLD.talent_engagement_id
      OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
      OR NEW.project_title_snapshot IS DISTINCT FROM OLD.project_title_snapshot
      OR NEW.team_name_snapshot IS DISTINCT FROM OLD.team_name_snapshot
      OR NEW.started_at IS DISTINCT FROM OLD.started_at
      OR (
        NEW.project_id IS DISTINCT FROM OLD.project_id
        AND NOT (OLD.project_id IS NOT NULL AND NEW.project_id IS NULL)
      ) THEN
      RAISE EXCEPTION 'ENGAGEMENT_ASSIGNMENT_IDENTITY_IMMUTABLE';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status
      AND NOT (OLD.status = 'active' AND NEW.status IN ('ended', 'cancelled')) THEN
      RAISE EXCEPTION 'ENGAGEMENT_ASSIGNMENT_STATUS_INVALID';
    END IF;

    RETURN NEW;
  ELSIF NEW.project_id IS NULL THEN
    RAISE EXCEPTION 'ENGAGEMENT_ASSIGNMENT_PROJECT_REQUIRED';
  END IF;

  IF NEW.client_engagement_id IS NOT NULL THEN
    SELECT kind, status INTO v_kind, v_status
    FROM public.engagements WHERE id = NEW.client_engagement_id;
    IF v_kind <> 'client_services' OR v_status <> 'active' THEN
      RAISE EXCEPTION 'CLIENT_ENGAGEMENT_NOT_ACTIVE';
    END IF;
    IF NEW.project_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.engagement_project_links
      WHERE engagement_id = NEW.client_engagement_id
        AND project_id = NEW.project_id
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'CLIENT_ENGAGEMENT_PROJECT_NOT_LINKED';
    END IF;
  END IF;

  IF NEW.talent_engagement_id IS NOT NULL THEN
    SELECT kind, status INTO v_kind, v_status
    FROM public.engagements WHERE id = NEW.talent_engagement_id;
    IF v_kind <> 'talent_services' OR v_status <> 'active' THEN
      RAISE EXCEPTION 'TALENT_ENGAGEMENT_NOT_ACTIVE';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.engagement_parties
      WHERE engagement_id = NEW.talent_engagement_id
        AND position = 'provider'
        AND capacity = 'talent'
        AND user_id = NEW.worker_user_id
    ) THEN
      RAISE EXCEPTION 'ASSIGNMENT_WORKER_NOT_TALENT_PROVIDER';
    END IF;
    IF NEW.project_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.engagement_project_links
      WHERE engagement_id = NEW.talent_engagement_id
        AND project_id = NEW.project_id
        AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'TALENT_ENGAGEMENT_PROJECT_NOT_LINKED';
    END IF;
  ELSIF NEW.client_engagement_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.engagement_parties
    WHERE engagement_id = NEW.client_engagement_id
      AND position = 'provider'
      AND capacity = 'consultant'
      AND user_id = NEW.worker_user_id
  ) THEN
    RAISE EXCEPTION 'UNCONTRACTED_WORKER_REQUIRES_TALENT_ENGAGEMENT';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_contract_positions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_status text;
  v_contract_id uuid;
BEGIN
  v_contract_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.contract_id
    ELSE NEW.contract_id
  END;

  SELECT relationship_kind, status INTO v_kind, v_status
  FROM public.contracts
  WHERE id = v_contract_id;

  IF TG_OP = 'DELETE' THEN
    IF v_status <> 'draft' THEN
      RAISE EXCEPTION 'CONTRACT_POSITION_DELETE_FORBIDDEN';
    END IF;
    RETURN OLD;
  END IF;

  IF (v_kind = 'client_services' AND NOT (
      (NEW.position = 'hirer' AND NEW.capacity = 'client')
      OR (NEW.position = 'provider' AND NEW.capacity = 'consultant')
    ))
    OR (v_kind = 'talent_services' AND NOT (
      (NEW.position = 'hirer' AND NEW.capacity = 'consultant')
      OR (NEW.position = 'provider' AND NEW.capacity = 'talent')
    )) THEN
    RAISE EXCEPTION 'CONTRACT_POSITION_CAPACITY_INVALID';
  END IF;

  IF TG_OP = 'UPDATE' AND v_status <> 'draft' AND (
    NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.capacity IS DISTINCT FROM OLD.capacity
    OR NEW.display_name_snapshot IS DISTINCT FROM OLD.display_name_snapshot
    OR NEW.email_snapshot IS DISTINCT FROM OLD.email_snapshot
  ) THEN
    RAISE EXCEPTION 'CONTRACT_POSITION_IDENTITY_LOCKED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_engagements_touch_updated_at ON public.engagements;
CREATE TRIGGER trg_engagements_touch_updated_at
BEFORE UPDATE ON public.engagements
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_touch_updated_at();

DROP TRIGGER IF EXISTS trg_engagements_guard ON public.engagements;
CREATE TRIGGER trg_engagements_guard
BEFORE UPDATE OR DELETE ON public.engagements
FOR EACH ROW EXECUTE FUNCTION public.tg_engagements_guard();

DROP TRIGGER IF EXISTS trg_engagement_parties_guard ON public.engagement_parties;
CREATE TRIGGER trg_engagement_parties_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.engagement_parties
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_parties_guard();

CREATE CONSTRAINT TRIGGER trg_engagements_require_parties
AFTER INSERT OR UPDATE ON public.engagements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_require_parties();

CREATE CONSTRAINT TRIGGER trg_engagement_parties_require_pair
AFTER INSERT ON public.engagement_parties
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_require_parties();

DROP TRIGGER IF EXISTS trg_engagement_project_links_touch_updated_at ON public.engagement_project_links;
CREATE TRIGGER trg_engagement_project_links_touch_updated_at
BEFORE UPDATE ON public.engagement_project_links
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_touch_updated_at();

DROP TRIGGER IF EXISTS trg_engagement_project_links_guard ON public.engagement_project_links;
CREATE TRIGGER trg_engagement_project_links_guard
BEFORE UPDATE OR DELETE ON public.engagement_project_links
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_project_links_guard();

CREATE CONSTRAINT TRIGGER trg_engagements_project_scope_check
AFTER INSERT OR UPDATE ON public.engagements
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_project_scope_check();

CREATE CONSTRAINT TRIGGER trg_engagement_links_project_scope_check
AFTER INSERT OR UPDATE OR DELETE ON public.engagement_project_links
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_project_scope_check();

DROP TRIGGER IF EXISTS trg_engagement_assignments_touch_updated_at ON public.engagement_assignments;
CREATE TRIGGER trg_engagement_assignments_touch_updated_at
BEFORE UPDATE ON public.engagement_assignments
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_touch_updated_at();

DROP TRIGGER IF EXISTS trg_engagement_assignments_guard ON public.engagement_assignments;
CREATE TRIGGER trg_engagement_assignments_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.engagement_assignments
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_assignments_guard();

DROP TRIGGER IF EXISTS trg_contract_positions_touch_updated_at ON public.contract_positions;
CREATE TRIGGER trg_contract_positions_touch_updated_at
BEFORE UPDATE ON public.contract_positions
FOR EACH ROW EXECUTE FUNCTION public.tg_engagement_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contract_positions_guard ON public.contract_positions;
CREATE TRIGGER trg_contract_positions_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.contract_positions
FOR EACH ROW EXECUTE FUNCTION public.tg_contract_positions_guard();

ALTER TABLE public.engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_project_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_positions ENABLE ROW LEVEL SECURITY;

-- Intentionally no anon/authenticated policies. The backend service role owns
-- all writes and returns redacted position-specific projections in P4b runtime.

REVOKE EXECUTE ON FUNCTION public.tg_engagement_touch_updated_at()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_engagements_guard()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_engagement_parties_guard()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_engagement_require_parties()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_engagement_project_links_guard()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_engagement_project_scope_check()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_engagement_assignments_guard()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_contract_positions_guard()
  FROM PUBLIC, anon, authenticated;

COMMIT;
