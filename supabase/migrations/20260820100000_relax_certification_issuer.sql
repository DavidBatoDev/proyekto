-- user_certifications.issuer: NOT NULL -> nullable.
--
-- The column has been NOT NULL since the identity-vetting schema
-- (20260226000000_identity_vetting_schema.sql:92-104), but AddCertificationDto
-- has always marked `issuer` @IsOptional(). Validation therefore passes and the
-- insert then fails with a raw Postgres 23502, surfaced to the caller as a 500.
--
-- The DTO is the half that is right. Certifications genuinely arrive without an
-- issuer: a LinkedIn "Save to PDF" export lists certification names in its
-- sidebar with no issuing body at all, so every imported certification would
-- 500 today. Course-completion certificates behave the same way.
--
-- Nothing is backfilled: existing rows already satisfy NOT NULL, and dropping a
-- constraint cannot invalidate them.
ALTER TABLE public.user_certifications
  ALTER COLUMN issuer DROP NOT NULL;

COMMENT ON COLUMN public.user_certifications.issuer IS
  'Issuing body. Nullable: bulk imports (LinkedIn PDF exports) frequently omit it.';
