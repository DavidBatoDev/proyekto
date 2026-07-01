-- Migration: 20260701000050_add_payout_method_qr.sql
--
-- Purpose:
--   Let members attach a scan-to-pay QR image (GCash/Maya/bank) to a payout
--   method so a paying owner can just scan it instead of typing the account
--   number — faster, fewer transcription errors.
--
--   Stores the PRIVATE R2 object key (same bucket as payout proofs); the image
--   is served via a short-lived presigned GET, never a public URL. Only the
--   owner and a paying team owner/admin can read it (same authz as the rest of
--   the method's sensitive fields).

ALTER TABLE public.payout_methods
  ADD COLUMN qr_path text;

COMMENT ON COLUMN public.payout_methods.qr_path IS
  'Private R2 object key for the method''s scan-to-pay QR image. Read via presigned GET; visible only to the owner and a paying team owner/admin.';
