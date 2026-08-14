-- Remove the commercial activation lifecycle from projects and contracts.
-- Signed contracts and their service windows are now the billing authority.

BEGIN;

UPDATE public.contracts
SET status = 'signed',
    updated_at = now()
WHERE status = 'active';

ALTER TABLE public.contracts
  DROP CONSTRAINT IF EXISTS contracts_status_check;
ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_status_check
  CHECK (status IN ('draft', 'sent', 'signed', 'ended', 'cancelled'));

DROP INDEX IF EXISTS public.uq_contracts_live_per_project;
DROP INDEX IF EXISTS public.idx_contracts_billing_window;

CREATE UNIQUE INDEX uq_contracts_signed_per_project
  ON public.contracts(project_id)
  WHERE status = 'signed';

CREATE INDEX idx_contracts_signed_billing_window
  ON public.contracts(service_start_date, service_end_date)
  WHERE status = 'signed';

CREATE OR REPLACE FUNCTION public.tg_contracts_lock_parties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('signed', 'ended', 'cancelled') THEN
    IF NEW.consultant_user_id IS DISTINCT FROM OLD.consultant_user_id THEN
      RAISE EXCEPTION 'CONTRACT_CONSULTANT_PARTY_LOCKED';
    END IF;
    IF NEW.client_user_id IS DISTINCT FROM OLD.client_user_id THEN
      RAISE EXCEPTION 'CONTRACT_CLIENT_PARTY_LOCKED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_contracts_lock_parties()
  FROM PUBLIC, anon, authenticated;

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
BEGIN
  IF p_party IS NULL OR p_party NOT IN ('consultant', 'client') THEN
    RAISE EXCEPTION 'CONTRACT_SIGNATURE_PARTY_INVALID';
  END IF;

  SELECT *
  INTO v_contract
  FROM public.contracts
  WHERE id = p_contract_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTRACT_NOT_FOUND';
  END IF;

  IF v_contract.project_id IS NULL THEN
    RAISE EXCEPTION 'CONTRACT_PROJECT_SEVERED';
  END IF;

  IF v_contract.status IN ('ended', 'cancelled') THEN
    RAISE EXCEPTION 'CONTRACT_NOT_SIGNABLE';
  END IF;

  v_consultant_user_id := COALESCE(
    v_contract.consultant_user_id,
    v_contract.created_by
  );
  IF v_consultant_user_id IS NULL
    OR public.is_active_consultant(v_consultant_user_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'CONSULTANT_ENROLLMENT_INACTIVE';
  END IF;

  v_consultant_signed :=
    p_party = 'consultant' OR v_contract.signed_by_consultant_at IS NOT NULL;
  v_client_signed :=
    p_party = 'client' OR v_contract.signed_by_client_at IS NOT NULL;
  v_next_status := CASE
    WHEN v_consultant_signed AND v_client_signed THEN 'signed'
    WHEN v_contract.status = 'draft' THEN 'sent'
    ELSE v_contract.status
  END;

  IF v_next_status = 'signed' THEN
    UPDATE public.contracts
    SET status = 'ended',
        updated_at = p_signed_at
    WHERE project_id = v_contract.project_id
      AND id <> v_contract.id
      AND status = 'signed';
  END IF;

  IF p_party = 'consultant' THEN
    UPDATE public.contracts
    SET signed_by_consultant_at = p_signed_at,
        signed_by_consultant_name = p_signer_name,
        signed_by_consultant_signature_url = p_signature_url,
        signed_by_consultant_signature_scale = p_scale,
        signed_by_consultant_signature_offset_x = p_offset_x,
        signed_by_consultant_signature_offset_y = p_offset_y,
        status = v_next_status,
        updated_at = p_signed_at
    WHERE id = p_contract_id
    RETURNING * INTO v_contract;
  ELSE
    UPDATE public.contracts
    SET signed_by_client_at = p_signed_at,
        signed_by_client_name = p_signer_name,
        signed_by_client_signature_url = p_signature_url,
        signed_by_client_signature_scale = p_scale,
        signed_by_client_signature_offset_x = p_offset_x,
        signed_by_client_signature_offset_y = p_offset_y,
        status = v_next_status,
        updated_at = p_signed_at
    WHERE id = p_contract_id
    RETURNING * INTO v_contract;
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
