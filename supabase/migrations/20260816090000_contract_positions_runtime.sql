-- P4b runtime: generic contract positions and atomic engagement activation.
--
-- This is additive and safe to apply before the P4b backend deploy. The
-- compatibility signing RPC remains available for legacy family-null contracts;
-- it delegates to the position RPC whenever a contract has P4b positions.
-- Existing agreements, invoice history, and signature links are not backfilled.
--
-- An engagement is created only by the final-sign transaction. It is not a
-- project authorization grant: project_access remains the execution authority.

BEGIN;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS fixed_fee numeric,
  ADD COLUMN IF NOT EXISTS time_tracking_mode text NOT NULL DEFAULT 'optional',
  ADD COLUMN IF NOT EXISTS time_approval_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS allow_manual_time boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS time_rounding_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weekly_time_limit_minutes integer,
  ADD COLUMN IF NOT EXISTS client_hours_detail_level text NOT NULL DEFAULT 'none';

ALTER TABLE public.contracts
  DROP CONSTRAINT IF EXISTS contracts_billing_mode_check,
  ADD CONSTRAINT contracts_billing_mode_check
    CHECK (billing_mode IN ('retainer', 'time_based', 'hybrid', 'fixed')),
  DROP CONSTRAINT IF EXISTS contracts_time_tracking_mode_check,
  ADD CONSTRAINT contracts_time_tracking_mode_check
    CHECK (time_tracking_mode IN ('disabled', 'optional', 'required')),
  DROP CONSTRAINT IF EXISTS contracts_time_approval_mode_check,
  ADD CONSTRAINT contracts_time_approval_mode_check
    CHECK (time_approval_mode IN ('none', 'provider_submit_hirer_approve')),
  DROP CONSTRAINT IF EXISTS contracts_time_rounding_minutes_check,
  ADD CONSTRAINT contracts_time_rounding_minutes_check
    CHECK (time_rounding_minutes IN (0, 5, 6, 10, 15, 30)),
  DROP CONSTRAINT IF EXISTS contracts_weekly_time_limit_minutes_check,
  ADD CONSTRAINT contracts_weekly_time_limit_minutes_check
    CHECK (weekly_time_limit_minutes IS NULL OR weekly_time_limit_minutes > 0),
  DROP CONSTRAINT IF EXISTS contracts_client_hours_detail_level_check,
  ADD CONSTRAINT contracts_client_hours_detail_level_check
    CHECK (client_hours_detail_level IN ('none', 'summary', 'detailed'));

COMMENT ON COLUMN public.contracts.fixed_fee IS
  'Generic fixed-price term. Fixed client contracts are activated in P4b but remain manually invoiced until milestone billing ships.';
COMMENT ON COLUMN public.contracts.recurring_fee IS
  'Legacy physical name for the generic monthly_rate API alias.';
COMMENT ON COLUMN public.contracts.client_hourly_rate IS
  'Legacy physical name for the generic hourly_rate API alias. Invoice composition reads it only for client_services contracts.';
COMMENT ON COLUMN public.contracts.provider_kind IS
  'Legacy physical name for consultant_identity_kind. It identifies the verified Consultant signing identity even when that Consultant is the hirer on a talent-services contract.';

DROP INDEX IF EXISTS public.uq_contracts_signed_per_project;
DROP INDEX IF EXISTS public.uq_contracts_live_per_project;
ALTER TABLE public.contracts
  DROP CONSTRAINT IF EXISTS contracts_project_version_unique;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contracts_signed_client_services_per_project
  ON public.contracts(project_id)
  WHERE status = 'signed'
    AND relationship_kind = 'client_services'
    AND project_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contracts_signed_per_family
  ON public.contracts(contract_family_id)
  WHERE status = 'signed' AND contract_family_id IS NOT NULL;

ALTER TABLE public.contract_signature_links
  DROP CONSTRAINT IF EXISTS contract_signature_links_party_check,
  ADD CONSTRAINT contract_signature_links_party_check
    CHECK (party IN ('client', 'counterparty'));
COMMENT ON COLUMN public.contract_signature_links.party IS
  'Legacy client or generic counterparty signing seat. New P4b links write counterparty; client remains accepted for rolling compatibility.';

CREATE OR REPLACE FUNCTION public.tg_contracts_lock_parties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('sent', 'signed', 'ended', 'cancelled') THEN
    IF NEW.consultant_user_id IS DISTINCT FROM OLD.consultant_user_id THEN
      RAISE EXCEPTION 'CONTRACT_CONSULTANT_PARTY_LOCKED';
    END IF;
    IF NEW.client_user_id IS DISTINCT FROM OLD.client_user_id THEN
      RAISE EXCEPTION 'CONTRACT_CLIENT_PARTY_LOCKED';
    END IF;
    IF NEW.relationship_kind IS DISTINCT FROM OLD.relationship_kind
      OR NEW.scope_mode IS DISTINCT FROM OLD.scope_mode
      OR NEW.contract_family_id IS DISTINCT FROM OLD.contract_family_id THEN
      RAISE EXCEPTION 'CONTRACT_COMMERCIAL_IDENTITY_LOCKED';
    END IF;
    -- A project delete is the one allowed project-id transition after send.
    IF NEW.project_id IS DISTINCT FROM OLD.project_id
      AND NOT (OLD.project_id IS NOT NULL AND NEW.project_id IS NULL) THEN
      RAISE EXCEPTION 'CONTRACT_PROJECT_SCOPE_LOCKED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_contracts_lock_parties()
  FROM PUBLIC, anon, authenticated;

ALTER POLICY "Project members can view contracts"
ON public.contracts
USING (
  EXISTS (
    SELECT 1
    FROM public.project_access pa
    WHERE pa.project_id = contracts.project_id
      AND pa.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = contracts.project_id
      AND p.owner_id = auth.uid()
  )
  OR contracts.client_user_id = auth.uid()
  OR contracts.consultant_user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.contract_positions cp
    WHERE cp.contract_id = contracts.id
      AND cp.user_id = auth.uid()
  )
);

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
      engagement_id, position, user_id, capacity, display_name_snapshot, email_snapshot
    ) VALUES
      (v_engagement_id, 'hirer', v_hirer.user_id, v_hirer.capacity, v_hirer.display_name_snapshot, v_hirer.email_snapshot),
      (v_engagement_id, 'provider', v_provider.user_id, v_provider.capacity, v_provider.display_name_snapshot, v_provider.email_snapshot);

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

  RETURN v_contract;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sign_contract_position_and_activate(
  uuid, text, text, text, numeric, numeric, numeric, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_contract_position_and_activate(
  uuid, text, text, text, numeric, numeric, numeric, timestamptz
) TO service_role;

-- Latest body: 20260814013000_remove_project_activation.sql. Keep this
-- function for rolling deployed callers and legacy contract families.
CREATE OR REPLACE FUNCTION public.sign_contract_and_flip(
  p_contract_id uuid,
  p_party text,
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
  v_consultant_user_id uuid;
  v_consultant_signed boolean;
  v_client_signed boolean;
  v_next_status text;
  v_position text;
BEGIN
  IF p_party IS NULL OR p_party NOT IN ('consultant', 'client') THEN
    RAISE EXCEPTION 'CONTRACT_SIGNATURE_PARTY_INVALID';
  END IF;

  SELECT * INTO v_contract
  FROM public.contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;

  IF EXISTS (SELECT 1 FROM public.contract_positions WHERE contract_id = p_contract_id) THEN
    IF p_party = 'consultant' THEN
      SELECT position INTO v_position FROM public.contract_positions
      WHERE contract_id = p_contract_id AND capacity = 'consultant';
    ELSE
      SELECT position INTO v_position FROM public.contract_positions
      WHERE contract_id = p_contract_id AND capacity <> 'consultant';
    END IF;
    RETURN public.sign_contract_position_and_activate(
      p_contract_id, v_position, p_signer_name, p_signature_url,
      p_scale, p_offset_x, p_offset_y, p_signed_at
    );
  END IF;

  IF v_contract.project_id IS NULL THEN RAISE EXCEPTION 'CONTRACT_PROJECT_SEVERED'; END IF;
  IF v_contract.status IN ('ended', 'cancelled') THEN RAISE EXCEPTION 'CONTRACT_NOT_SIGNABLE'; END IF;
  v_consultant_user_id := COALESCE(v_contract.consultant_user_id, v_contract.created_by);
  IF v_consultant_user_id IS NULL OR public.is_active_consultant(v_consultant_user_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'CONSULTANT_ENROLLMENT_INACTIVE';
  END IF;

  v_consultant_signed := p_party = 'consultant' OR v_contract.signed_by_consultant_at IS NOT NULL;
  v_client_signed := p_party = 'client' OR v_contract.signed_by_client_at IS NOT NULL;
  v_next_status := CASE
    WHEN v_consultant_signed AND v_client_signed THEN 'signed'
    WHEN v_contract.status = 'draft' THEN 'sent'
    ELSE v_contract.status
  END;

  IF v_next_status = 'signed' THEN
    UPDATE public.contracts SET status = 'ended', updated_at = p_signed_at
    WHERE project_id = v_contract.project_id AND id <> v_contract.id
      AND status = 'signed' AND relationship_kind = 'client_services';
  END IF;

  IF p_party = 'consultant' THEN
    UPDATE public.contracts SET
      signed_by_consultant_at = p_signed_at, signed_by_consultant_name = p_signer_name,
      signed_by_consultant_signature_url = p_signature_url,
      signed_by_consultant_signature_scale = p_scale,
      signed_by_consultant_signature_offset_x = p_offset_x,
      signed_by_consultant_signature_offset_y = p_offset_y,
      status = v_next_status, updated_at = p_signed_at
    WHERE id = p_contract_id RETURNING * INTO v_contract;
  ELSE
    UPDATE public.contracts SET
      signed_by_client_at = p_signed_at, signed_by_client_name = p_signer_name,
      signed_by_client_signature_url = p_signature_url,
      signed_by_client_signature_scale = p_scale,
      signed_by_client_signature_offset_x = p_offset_x,
      signed_by_client_signature_offset_y = p_offset_y,
      status = v_next_status, updated_at = p_signed_at
    WHERE id = p_contract_id RETURNING * INTO v_contract;
  END IF;
  RETURN v_contract;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sign_contract_and_flip(
  uuid, text, text, text, numeric, numeric, numeric, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_contract_and_flip(
  uuid, text, text, text, numeric, numeric, numeric, timestamptz
) TO service_role;

COMMIT;
