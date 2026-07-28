-- Free placement for signature images.
--
-- A signature is an overlay stamped onto a fixed signature field, the way a
-- PDF signer works — it must never change the height of the document, and it
-- must sit above the page content rather than in the text flow. Scale alone
-- couldn't express that: growing the image still had to push the rule down to
-- avoid clipping, which knocked the two signature columns out of alignment.
--
-- With an offset the image can be positioned freely over the field, so it can
-- be nudged onto the rule at any size while the document layout stays frozen.
--
-- Units are MULTIPLES OF THE BASE SIGNATURE HEIGHT, not pixels, so one stored
-- value renders correctly in the compact preview, the full-size document, and
-- the PDF — each of which has a different base height.
--   offset_x: positive moves right
--   offset_y: positive moves up from the signature rule

alter table contracts
  add column if not exists signed_by_consultant_signature_offset_x numeric(5, 3)
    not null default 0,
  add column if not exists signed_by_consultant_signature_offset_y numeric(5, 3)
    not null default 0,
  add column if not exists signed_by_client_signature_offset_x numeric(5, 3)
    not null default 0,
  add column if not exists signed_by_client_signature_offset_y numeric(5, 3)
    not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'contracts_signature_offset_range'
  ) then
    alter table contracts
      add constraint contracts_signature_offset_range
      check (
        signed_by_consultant_signature_offset_x between -3 and 3
        and signed_by_consultant_signature_offset_y between -3 and 3
        and signed_by_client_signature_offset_x between -3 and 3
        and signed_by_client_signature_offset_y between -3 and 3
      );
  end if;
end $$;

comment on column contracts.signed_by_consultant_signature_offset_x is
  'Provider signature horizontal offset, in multiples of the base signature height. Positive = right.';
comment on column contracts.signed_by_consultant_signature_offset_y is
  'Provider signature vertical offset, in multiples of the base signature height. Positive = up.';
comment on column contracts.signed_by_client_signature_offset_x is
  'Client signature horizontal offset, in multiples of the base signature height. Positive = right.';
comment on column contracts.signed_by_client_signature_offset_y is
  'Client signature vertical offset, in multiples of the base signature height. Positive = up.';
