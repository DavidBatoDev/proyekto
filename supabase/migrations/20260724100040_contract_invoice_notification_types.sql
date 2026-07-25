-- Migration: 20260724100040_contract_invoice_notification_types.sql
-- Date: July 24, 2026
-- Description:
--   Notification types for the contract + automated-invoicing flow. The
--   scheduler never sends anything to a client: it creates a DRAFT invoice and
--   raises `invoice_draft_ready` for the consultant/owner to review and issue.

INSERT INTO public.notification_types (name, category, priority)
VALUES
  ('invoice_draft_ready', 'specific', 'high'),
  ('contract_signed', 'specific', 'medium'),
  ('contract_ending_soon', 'specific', 'medium')
ON CONFLICT (name) DO NOTHING;
