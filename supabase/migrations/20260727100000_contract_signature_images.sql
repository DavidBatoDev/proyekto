-- Contract signature images
--
-- Adds optional signature-image URLs alongside the existing typed-name
-- signature stamps. A party can now attach an uploaded signature image (stored
-- in the public R2 bucket under contract_signatures/) which renders in the
-- agreement document; the typed name remains the legal stamp, the image is
-- decorative/confirmatory and optional.

alter table public.contracts
  add column if not exists signed_by_consultant_signature_url text,
  add column if not exists signed_by_client_signature_url text;

comment on column public.contracts.signed_by_consultant_signature_url is
  'Public URL of the service provider''s uploaded signature image (optional).';
comment on column public.contracts.signed_by_client_signature_url is
  'Public URL of the client''s uploaded signature image (optional).';
