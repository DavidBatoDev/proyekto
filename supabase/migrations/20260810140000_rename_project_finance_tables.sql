-- Migration: rename project finance tables
-- Date: August 10, 2026
--
-- These records remain scoped by project_id, but they belong to the Finance
-- domain rather than the project-navigation surface. Rename the tables and
-- their schema objects as a hard cutover; no compatibility views are kept.

ALTER TABLE public.project_economics RENAME TO finance_project_settings;

ALTER TABLE public.finance_project_settings RENAME CONSTRAINT project_economics_pkey TO finance_project_settings_pkey;
ALTER TABLE public.finance_project_settings RENAME CONSTRAINT project_economics_project_id_fkey TO finance_project_settings_project_id_fkey;
ALTER TABLE public.finance_project_settings RENAME CONSTRAINT project_economics_contract_id_fkey TO finance_project_settings_contract_id_fkey;
ALTER TABLE public.finance_project_settings RENAME CONSTRAINT project_economics_created_by_fkey TO finance_project_settings_created_by_fkey;
ALTER TABLE public.finance_project_settings RENAME CONSTRAINT project_economics_percent_range_check TO finance_project_settings_percent_range_check;
ALTER TABLE public.finance_project_settings RENAME CONSTRAINT project_economics_percent_sum_check TO finance_project_settings_percent_sum_check;
ALTER TABLE public.finance_project_settings RENAME CONSTRAINT project_economics_allocation_mode_check TO finance_project_settings_allocation_mode_check;
ALTER INDEX public.idx_project_economics_contract_id RENAME TO idx_finance_project_settings_contract_id;
ALTER TRIGGER trg_project_economics_updated_at ON public.finance_project_settings RENAME TO trg_finance_project_settings_updated_at;
ALTER POLICY "Project owners can view project economics" ON public.finance_project_settings RENAME TO "Authorized users can view finance project settings";
ALTER POLICY "Project owners can insert project economics" ON public.finance_project_settings RENAME TO "Authorized users can insert finance project settings";
ALTER POLICY "Project owners can update project economics" ON public.finance_project_settings RENAME TO "Authorized users can update finance project settings";

ALTER TABLE public.project_member_allocations RENAME TO finance_member_allocations;

ALTER TABLE public.finance_member_allocations RENAME CONSTRAINT project_member_allocations_pkey TO finance_member_allocations_pkey;
ALTER TABLE public.finance_member_allocations RENAME CONSTRAINT project_member_allocations_project_id_fkey TO finance_member_allocations_project_id_fkey;
ALTER TABLE public.finance_member_allocations RENAME CONSTRAINT project_member_allocations_user_id_fkey TO finance_member_allocations_user_id_fkey;
ALTER TABLE public.finance_member_allocations RENAME CONSTRAINT project_member_allocations_created_by_fkey TO finance_member_allocations_created_by_fkey;
ALTER TABLE public.finance_member_allocations RENAME CONSTRAINT project_member_allocations_project_team_fk TO finance_member_allocations_project_team_fk;
ALTER TABLE public.finance_member_allocations RENAME CONSTRAINT project_member_allocations_amount_check TO finance_member_allocations_amount_check;
ALTER INDEX public.idx_project_member_allocations_project RENAME TO idx_finance_member_allocations_project;
ALTER TRIGGER trg_project_member_allocations_updated_at ON public.finance_member_allocations RENAME TO trg_finance_member_allocations_updated_at;
ALTER POLICY "Project owners can view member allocations" ON public.finance_member_allocations RENAME TO "Authorized users can view finance member allocations";
ALTER POLICY "Project owners can insert member allocations" ON public.finance_member_allocations RENAME TO "Authorized users can insert finance member allocations";
ALTER POLICY "Project owners can update member allocations" ON public.finance_member_allocations RENAME TO "Authorized users can update finance member allocations";
ALTER POLICY "Project owners can delete member allocations" ON public.finance_member_allocations RENAME TO "Authorized users can delete finance member allocations";

COMMENT ON COLUMN public.finance_project_settings.allocation_mode IS
  'equal = every member in the split draws the same slice, derived on read. custom = per-member amounts in finance_member_allocations govern.';
