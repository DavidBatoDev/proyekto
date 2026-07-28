-- Per-party signature display scale.
--
-- Signature images were rendered at one fixed height everywhere (56px in the
-- editor, 44px in the compact preview, 28pt in the PDF). A scanned signature
-- with generous whitespace around the ink therefore came out unreadably small,
-- with no way to correct it. These columns store a display multiplier the
-- signer controls; every render site multiplies its base height by it.
--
-- Cosmetic only — it changes how the signature is drawn, never the agreement.

alter table contracts
  add column if not exists signed_by_consultant_signature_scale numeric(3, 2)
    not null default 1,
  add column if not exists signed_by_client_signature_scale numeric(3, 2)
    not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contracts_signature_scale_range'
  ) then
    alter table contracts
      add constraint contracts_signature_scale_range
      check (
        signed_by_consultant_signature_scale between 0.5 and 3
        and signed_by_client_signature_scale between 0.5 and 3
      );
  end if;
end $$;

comment on column contracts.signed_by_consultant_signature_scale is
  'Display multiplier (0.5-3) for the provider signature image. 1 = base size.';
comment on column contracts.signed_by_client_signature_scale is
  'Display multiplier (0.5-3) for the client signature image. 1 = base size.';
