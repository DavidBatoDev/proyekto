-- Migration: 20260818120200_consultant_services_lossless_contract_copy.sql
-- Date: August 18, 2026
-- Description:
--   Two corrections to 20260818120000, both found by reading the code the table
--   feeds rather than the table itself.
--
--   1. `description` was capped at 2000, but the whole point of the catalog is
--      that picking an entry COPIES it into `contracts.services`, and
--      `ContractServiceDto.description` (backend/src/modules/marketplace/
--      contracts/dto/contracts.dto.ts) is `@MaxLength(1000)`. A consultant who
--      wrote 1500 characters would have every "add to contract" rejected with a
--      validation error on the longest, most-worked-on service they own. The
--      copy has to be lossless, so the source cannot be wider than the target.
--      Narrowing is free today: the table holds zero rows.
--
--      (`price_unit` needs no such fix — 'project' | 'hour' | 'month' is
--      already a strict subset of SERVICE_UNIT_OPTIONS in
--      web/src/components/finance/ProjectContract.tsx, so the copy needs no
--      mapping table.)
--
--   2. The sub-category cap trigger from 20260818120100 counted and then
--      inserted with nothing serialising the two. Two concurrent inserts at four
--      rows would both read four and both succeed, leaving six. A per-user
--      advisory lock closes it. The cost is nothing: writes here are one
--      consultant editing their own placements, never a hot path.

-- ---------------------------------------------------------------------------
-- 1. Lossless copy into contracts.services
-- ---------------------------------------------------------------------------

ALTER TABLE public.consultant_services
  DROP CONSTRAINT IF EXISTS consultant_services_description_check;

ALTER TABLE public.consultant_services
  ADD CONSTRAINT consultant_services_description_check
    CHECK (description IS NULL OR length(trim(description)) BETWEEN 10 AND 1000);

COMMENT ON COLUMN public.consultant_services.description IS
  'Capped at 1000 to match ContractServiceDto.description, because picking a service copies it verbatim into contracts.services. Widening this without widening that DTO breaks "add to contract" for exactly the longest entries.';

-- ---------------------------------------------------------------------------
-- 2. Make the sub-category cap actually a cap
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_consultant_subcategories_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  -- Serialise per user so the count below cannot be read stale by a concurrent
  -- insert. Transaction-scoped: released at commit or rollback, no cleanup.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));

  SELECT count(*) INTO v_count
  FROM public.consultant_subcategories
  WHERE user_id = NEW.user_id;

  IF v_count >= 5 THEN
    RAISE EXCEPTION 'CONSULTANT_SUBCATEGORY_LIMIT'
      USING HINT = 'A consultant may appear in at most 5 sub-categories.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_consultant_subcategories_cap()
  FROM PUBLIC, anon, authenticated;
