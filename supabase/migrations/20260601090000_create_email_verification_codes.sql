-- Stores hashed email verification OTPs used by backend /api/auth/email-verification/*
create table if not exists public.email_verification_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null check (purpose in ('signup', 'login')),
  code_hash text not null,
  salt text not null,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

comment on table public.email_verification_codes is 'Hashed email verification OTPs (signup/login), consumed on successful verification.';

create index if not exists email_verification_codes_email_idx
  on public.email_verification_codes (email);

create index if not exists email_verification_codes_created_idx
  on public.email_verification_codes (created_at desc);

alter table public.email_verification_codes enable row level security;

-- No public policies: service role only.
