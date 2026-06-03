-- Stores hashed phone OTPs used by backend /api/profile/phone-verification/*
create table if not exists public.phone_verification_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  phone_number text not null,
  code_hash text not null,
  salt text not null,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

comment on table public.phone_verification_codes is 'Hashed phone OTPs (profile verification), consumed on successful verification.';

create index if not exists phone_verification_codes_user_idx
  on public.phone_verification_codes (user_id);

create index if not exists phone_verification_codes_created_idx
  on public.phone_verification_codes (created_at desc);

alter table public.phone_verification_codes enable row level security;

-- No public policies: service role only.
