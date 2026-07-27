-- Migration: 20260724110010_contract_services_catalog.sql
-- Date: July 24, 2026
-- Description:
--   A defined list of services on the contract, reused as invoice line items so
--   a consultant picks from contracted services instead of retyping each line.
--
--   Modeled exactly on the existing `contracts.clauses` jsonb column: an ordered
--   array of structured objects, validated by a nested class-validator DTO,
--   passed through on update. Each entry is
--   {id, name, description, unit, unit_rate, position}.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS services jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.contracts.services IS
  'Ordered catalog of billable services [{id,name,description,unit,unit_rate,position}], picked into invoice line items.';
