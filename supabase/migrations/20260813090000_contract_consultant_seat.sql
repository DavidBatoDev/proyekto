-- P4a: durable contract positions and atomic signing.
--
-- The consultant seat is deliberately nullable until the engagement link layer
-- ships. Existing contracts are backfilled from created_by only when that user
-- has an enrollment row; enrollment status is not part of historical identity.
-- The statement is safe to repeat after backend deploy to cover contracts made
-- during the expand/deploy window.
--
-- sign_contract_and_flip() is service-role only. It locks the contract, checks
-- current consultant enrollment, stamps either party, supersedes an older live
-- version when necessary, and derives the resulting status in one transaction.
-- It CALLS is_active_consultant(); the predicate's latest body remains owned by
-- 20260812101000_retire_profile_capability_flags.sql and is not redefined here.

BEGIN;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS consultant_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contracts_consultant_user_id_fkey'
      AND conrelid = 'public.contracts'::regclass
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_consultant_user_id_fkey
      FOREIGN KEY (consultant_user_id)
      REFERENCES public.consultant_profiles(user_id)
      ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contracts_no_self_dealing'
      AND conrelid = 'public.contracts'::regclass
  ) THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_no_self_dealing
      CHECK (
        client_user_id IS NULL
        OR consultant_user_id IS NULL
        OR client_user_id <> consultant_user_id
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_contracts_consultant_user_id
  ON public.contracts(consultant_user_id)
  WHERE consultant_user_id IS NOT NULL;

COMMENT ON COLUMN public.contracts.consultant_user_id IS
  'Durable consultant party to this agreement. Historical identity persists across enrollment suspension or revocation; active enrollment is re-checked when signing.';

UPDATE public.contracts AS c
SET consultant_user_id = c.created_by
WHERE c.consultant_user_id IS NULL
  AND c.created_by IN (
    SELECT cp.user_id
    FROM public.consultant_profiles AS cp
  );

CREATE OR REPLACE FUNCTION public.tg_contracts_lock_parties()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('signed', 'active', 'ended', 'cancelled') THEN
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

DROP TRIGGER IF EXISTS trg_contracts_lock_parties ON public.contracts;
CREATE TRIGGER trg_contracts_lock_parties
BEFORE UPDATE ON public.contracts
FOR EACH ROW
EXECUTE FUNCTION public.tg_contracts_lock_parties();

-- Latest policy body: 20260811092000_finance_rls_project_access_only.sql.
DROP POLICY IF EXISTS "Project members can view contracts" ON public.contracts;
CREATE POLICY "Project members can view contracts"
ON public.contracts
FOR SELECT
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
);

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
      AND status IN ('signed', 'active');
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
