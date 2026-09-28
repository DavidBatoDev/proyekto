-- Teams on contract seats, per-kind agreement titles, and talent team joins.
--
-- A seat's team is "this person signs on behalf of this team": the agency a
-- consultant bills as, the company a client contracts as, the team a talent is
-- engaged into. It lives on the SEAT (contract_positions), not the contract,
-- because the legacy client_*/provider_* column blocks are reversed on talent
-- contracts — the seat is the only side-neutral place to put it.
--
-- This is identity, not party-ship: seats stay profile FKs (the P4c
-- organisation work is still what would let a team HOLD a seat). The team is
-- snapshotted by name, and the engagement keeps its own copy at activation.
--
-- The service enforces who may set it (a seat's own user, on a team they own,
-- before that seat signs); the database only records it.

ALTER TABLE public.contract_positions
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_name_snapshot text;

CREATE INDEX IF NOT EXISTS idx_contract_positions_team
  ON public.contract_positions(team_id)
  WHERE team_id IS NOT NULL;

ALTER TABLE public.engagement_parties
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS team_name_snapshot text;

CREATE INDEX IF NOT EXISTS idx_engagement_parties_team
  ON public.engagement_parties(team_id)
  WHERE team_id IS NOT NULL;

-- The client side's counterpart to provider_kind: a person, or a company
-- (whose details the client may fill from one of their own teams at signing).
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS client_kind text NOT NULL DEFAULT 'individual';
ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_client_kind_check;
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_client_kind_check
  CHECK (client_kind IN ('individual', 'company'));

-- The document's title is chosen when the contract is created (by kind) and
-- stored, so a signed paper is never retitled by a later template change.
-- Everything that exists today was issued as a Service Agreement.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS document_title text NOT NULL DEFAULT 'Service Agreement';

-- Latest body was 20260816090000_contract_positions_runtime.sql. Changes:
-- engagement_parties copy each seat's team; a signed talent contract adds the
-- talent to the hirer seat's team.
CREATE OR REPLACE FUNCTION public.sign_contract_position_and_activate(
  p_contract_id uuid,
  p_position text,
  p_signer_name text,
  p_signature_url text,
  p_scale numeric,
  p_offset_x numeric,
  p_offset_y numeric,
  p_signed_at timestamptz
)
RETURNS public.contracts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract public.contracts%ROWTYPE;
  v_consultant_id uuid;
  v_consultant_position text;
  v_hirer public.contract_positions%ROWTYPE;
  v_provider public.contract_positions%ROWTYPE;
  v_all_signed boolean;
  v_engagement_id uuid;
  v_effective_from date;
  v_project_title text;
BEGIN
  IF p_position IS NULL OR p_position NOT IN ('hirer', 'provider') THEN
    RAISE EXCEPTION 'CONTRACT_POSITION_INVALID';
  END IF;

  SELECT * INTO v_contract
  FROM public.contracts
  WHERE id = p_contract_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTRACT_NOT_FOUND';
  END IF;
  IF v_contract.status IN ('ended', 'cancelled') THEN
    RAISE EXCEPTION 'CONTRACT_NOT_SIGNABLE';
  END IF;
  IF v_contract.status = 'signed' THEN
    RAISE EXCEPTION 'CONTRACT_ALREADY_SIGNED';
  END IF;
  IF v_contract.scope_mode = 'project_specific' AND v_contract.project_id IS NULL THEN
    RAISE EXCEPTION 'CONTRACT_PROJECT_SEVERED';
  END IF;
  IF v_contract.service_start_date IS NULL OR v_contract.service_end_date IS NULL THEN
    RAISE EXCEPTION 'CONTRACT_TERM_INCOMPLETE';
  END IF;
  IF v_contract.billing_mode = 'fixed' AND v_contract.fixed_fee IS NULL THEN
    RAISE EXCEPTION 'CONTRACT_FIXED_FEE_REQUIRED';
  END IF;
  IF v_contract.billing_mode IN ('retainer', 'hybrid')
    AND v_contract.recurring_fee IS NULL THEN
    RAISE EXCEPTION 'CONTRACT_MONTHLY_RATE_REQUIRED';
  END IF;
  IF v_contract.billing_mode IN ('time_based', 'hybrid')
    AND v_contract.client_hourly_rate IS NULL THEN
    RAISE EXCEPTION 'CONTRACT_HOURLY_RATE_REQUIRED';
  END IF;

  SELECT * INTO v_hirer FROM public.contract_positions
  WHERE contract_id = v_contract.id AND position = 'hirer';
  SELECT * INTO v_provider FROM public.contract_positions
  WHERE contract_id = v_contract.id AND position = 'provider';
  IF v_hirer.contract_id IS NULL OR v_provider.contract_id IS NULL THEN
    RAISE EXCEPTION 'CONTRACT_REQUIRES_TWO_POSITIONS';
  END IF;
  IF v_hirer.user_id = v_provider.user_id THEN
    RAISE EXCEPTION 'CONTRACT_SELF_DEALING';
  END IF;

  v_consultant_position := CASE
    WHEN v_hirer.capacity = 'consultant' THEN 'hirer'
    WHEN v_provider.capacity = 'consultant' THEN 'provider'
    ELSE NULL
  END;
  v_consultant_id := CASE
    WHEN v_consultant_position = 'hirer' THEN v_hirer.user_id
    WHEN v_consultant_position = 'provider' THEN v_provider.user_id
    ELSE NULL
  END;
  IF v_consultant_id IS NULL
    OR public.is_active_consultant(v_consultant_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'CONSULTANT_ENROLLMENT_INACTIVE';
  END IF;

  UPDATE public.contract_positions
  SET signer_name = p_signer_name,
      signature_url = p_signature_url,
      signature_scale = p_scale,
      signature_offset_x = p_offset_x,
      signature_offset_y = p_offset_y,
      signed_at = p_signed_at
  WHERE contract_id = v_contract.id
    AND position = p_position;

  IF p_position = v_consultant_position THEN
    UPDATE public.contracts
    SET signed_by_consultant_at = p_signed_at,
        signed_by_consultant_name = p_signer_name,
        signed_by_consultant_signature_url = p_signature_url,
        signed_by_consultant_signature_scale = p_scale,
        signed_by_consultant_signature_offset_x = p_offset_x,
        signed_by_consultant_signature_offset_y = p_offset_y,
        status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
        updated_at = p_signed_at
    WHERE id = v_contract.id;
  ELSE
    UPDATE public.contracts
    SET signed_by_client_at = p_signed_at,
        signed_by_client_name = p_signer_name,
        signed_by_client_signature_url = p_signature_url,
        signed_by_client_signature_scale = p_scale,
        signed_by_client_signature_offset_x = p_offset_x,
        signed_by_client_signature_offset_y = p_offset_y,
        status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
        updated_at = p_signed_at
    WHERE id = v_contract.id;
  END IF;

  SELECT count(*) = 2 INTO v_all_signed
  FROM public.contract_positions
  WHERE contract_id = v_contract.id AND signed_at IS NOT NULL;
  IF NOT v_all_signed THEN
    SELECT * INTO v_contract FROM public.contracts WHERE id = v_contract.id;
    RETURN v_contract;
  END IF;

  v_engagement_id := v_contract.engagement_id;
  v_effective_from := COALESCE(
    v_contract.amendment_effective_date,
    v_contract.service_start_date
  );

  IF v_engagement_id IS NULL THEN
    INSERT INTO public.engagements(
      kind, scope_mode, status, origin, activated_by_contract_id, started_at, created_by
    ) VALUES (
      v_contract.relationship_kind, v_contract.scope_mode, 'active', 'contract',
      v_contract.id, p_signed_at, v_consultant_id
    ) RETURNING id INTO v_engagement_id;

    INSERT INTO public.engagement_parties(
      engagement_id, position, user_id, capacity, display_name_snapshot, email_snapshot,
      team_id, team_name_snapshot
    ) VALUES
      (v_engagement_id, 'hirer', v_hirer.user_id, v_hirer.capacity, v_hirer.display_name_snapshot, v_hirer.email_snapshot,
       v_hirer.team_id, v_hirer.team_name_snapshot),
      (v_engagement_id, 'provider', v_provider.user_id, v_provider.capacity, v_provider.display_name_snapshot, v_provider.email_snapshot,
       v_provider.team_id, v_provider.team_name_snapshot);

    IF v_contract.scope_mode = 'project_specific' THEN
      SELECT title INTO v_project_title FROM public.projects WHERE id = v_contract.project_id;
      INSERT INTO public.engagement_project_links(
        engagement_id, project_id, project_title_snapshot, basis, linked_by
      ) VALUES (
        v_engagement_id, v_contract.project_id,
        COALESCE(v_contract.project_title_snapshot, v_project_title, 'Untitled project'),
        'contract_scope', v_consultant_id
      );
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.engagement_parties ep
      WHERE ep.engagement_id = v_engagement_id
        AND ep.position = 'hirer' AND ep.user_id = v_hirer.user_id
    ) OR NOT EXISTS (
      SELECT 1 FROM public.engagement_parties ep
      WHERE ep.engagement_id = v_engagement_id
        AND ep.position = 'provider' AND ep.user_id = v_provider.user_id
    ) THEN
      RAISE EXCEPTION 'ENGAGEMENT_PARTIES_MISMATCH';
    END IF;
    IF v_effective_from < CURRENT_DATE THEN
      RAISE EXCEPTION 'AMENDMENT_EFFECTIVE_DATE_PAST';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.engagement_time_settings s
      WHERE s.engagement_id = v_engagement_id
        AND s.effective_until IS NULL
        AND v_effective_from <= s.effective_from
    ) THEN
      RAISE EXCEPTION 'AMENDMENT_EFFECTIVE_DATE_NOT_PROSPECTIVE';
    END IF;
    UPDATE public.engagement_time_settings
    SET effective_until = v_effective_from - 1
    WHERE engagement_id = v_engagement_id AND effective_until IS NULL;
    UPDATE public.engagement_time_rates
    SET effective_until = v_effective_from - 1
    WHERE engagement_id = v_engagement_id AND effective_until IS NULL;
  END IF;

  -- End only the previous legal authority. Talent contracts may coexist on a project.
  UPDATE public.contracts
  SET status = 'ended', updated_at = p_signed_at
  WHERE id <> v_contract.id
    AND status = 'signed'
    AND (
      (contract_family_id IS NOT NULL AND contract_family_id = v_contract.contract_family_id)
      OR (
        v_contract.relationship_kind = 'client_services'
        AND relationship_kind = 'client_services'
        AND project_id = v_contract.project_id
        AND project_id IS NOT NULL
      )
    );

  UPDATE public.contracts
  SET engagement_id = v_engagement_id,
      status = 'signed',
      updated_at = p_signed_at
  WHERE id = v_contract.id
  RETURNING * INTO v_contract;

  INSERT INTO public.engagement_time_settings(
    engagement_id, source_contract_id, tracking_mode, approval_mode,
    allow_manual_entries, rounding_minutes, weekly_limit_minutes,
    client_hours_detail_level, effective_from, created_by
  ) VALUES (
    v_engagement_id, v_contract.id, v_contract.time_tracking_mode,
    v_contract.time_approval_mode, v_contract.allow_manual_time,
    v_contract.time_rounding_minutes, v_contract.weekly_time_limit_minutes,
    v_contract.client_hours_detail_level, v_effective_from, v_consultant_id
  );

  IF v_contract.billing_mode IN ('retainer', 'hybrid') THEN
    INSERT INTO public.engagement_time_rates(
      engagement_id, source_contract_id, worker_user_id, rate_kind, unit, amount,
      currency, effective_from
    ) VALUES (
      v_engagement_id, v_contract.id,
      CASE WHEN v_contract.relationship_kind = 'talent_services' THEN v_provider.user_id ELSE NULL END,
      CASE WHEN v_contract.relationship_kind = 'talent_services' THEN 'cost' ELSE 'billing' END,
      'month', COALESCE(v_contract.recurring_fee, 0), v_contract.currency, v_effective_from
    );
  END IF;
  IF v_contract.billing_mode IN ('time_based', 'hybrid') THEN
    INSERT INTO public.engagement_time_rates(
      engagement_id, source_contract_id, worker_user_id, rate_kind, unit, amount,
      currency, effective_from
    ) VALUES (
      v_engagement_id, v_contract.id,
      CASE WHEN v_contract.relationship_kind = 'talent_services' THEN v_provider.user_id ELSE NULL END,
      CASE WHEN v_contract.relationship_kind = 'talent_services' THEN 'cost' ELSE 'billing' END,
      'hour', COALESCE(v_contract.client_hourly_rate, 0), v_contract.currency, v_effective_from
    );
  END IF;
  IF v_contract.billing_mode = 'fixed' THEN
    INSERT INTO public.engagement_time_rates(
      engagement_id, source_contract_id, worker_user_id, rate_kind, unit, amount,
      currency, effective_from
    ) VALUES (
      v_engagement_id, v_contract.id,
      CASE WHEN v_contract.relationship_kind = 'talent_services' THEN v_provider.user_id ELSE NULL END,
      CASE WHEN v_contract.relationship_kind = 'talent_services' THEN 'cost' ELSE 'billing' END,
      'fixed', COALESCE(v_contract.fixed_fee, 0), v_contract.currency, v_effective_from
    );
  END IF;

  -- A talent signed onto a team becomes a member of it, in the same
  -- transaction as the contract that justifies the membership. Idempotent:
  -- an existing member (any role) is left exactly as they are.
  IF v_contract.relationship_kind = 'talent_services' AND v_hirer.team_id IS NOT NULL THEN
    INSERT INTO public.team_members(team_id, user_id, role)
    VALUES (v_hirer.team_id, v_provider.user_id, 'member')
    ON CONFLICT (team_id, user_id) DO NOTHING;
  END IF;

  RETURN v_contract;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sign_contract_position_and_activate(
  uuid, text, text, text, numeric, numeric, numeric, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_contract_position_and_activate(
  uuid, text, text, text, numeric, numeric, numeric, timestamptz
) TO service_role;
