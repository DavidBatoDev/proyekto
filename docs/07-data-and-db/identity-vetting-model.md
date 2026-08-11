# Identity & Vetting Model

> **Last updated:** 2026-08-12 · **Status:** current

Proyekto is a **managed** platform, not an open marketplace — before a user can
manage projects as a Consultant or be hired as Talent, the platform must know
their full professional identity. That identity lives in `profiles` plus a set of
**`user_*`** sub-entity tables. This is the permanent identity layer regardless of
which responsibilities the user has on a project.

> The `user_*` naming is deliberate and current: these are reusable identity and
> professional facts. `consultant_profiles` is a separate enrollment capability,
> not a replacement for those details or for the shared `user_rate_settings` card.

## The tables

`profiles` is the core record (1:1 with `auth.users`, carrying identity, onboarding,
and guest fields). It has no role, consultant-verification flag, or public-profile
flag. Marketplace capabilities are stateful enrollment rows:

| Table | Holds | Cardinality |
| --- | --- | --- |
| `user_verifications` | email / phone / identity verification status | one per `(user_id, type)` |
| `user_identity_documents` | KYC docs (passport, national_id, …), storage key | many |
| `user_educations` | degrees, institutions, years | many |
| `user_certifications` | certs + credential URL, admin-verified badge | many |
| `user_licenses` | regulated-industry licenses (`license_type`) | many |
| `user_skills` | skill + `proficiency_level` + years | one per `(user_id, skill_id)` |
| `user_languages` | language + `fluency_level` | one per `(user_id, language_id)` |
| `user_experiences` | employment history | many |
| `user_portfolios` | project showcases (url, image, tags, position) | many |
| `user_specializations` | industry niches (`specialization_category`) | one per `(user_id, category)` |
| `user_rate_settings` | rate card (hourly rate, currency, availability) | 1:1 |
| `user_stats` | aggregated career stats (earnings, ratings, jobs) | 1:1 |
| `consultant_profiles` | consultant capability and lifecycle audit (`pending`, `verified`, `suspended`, `revoked`) | 0..1 per user |
| `freelancer_profiles` | public-pool enrollment (`active`, `paused`) | 0..1 per user |
| `skills`, `languages` | reference catalogs (master lists) | shared |

Why join tables instead of JSONB on `profiles`? So the matchmaker can query across
them — e.g. "expert Python developers, available, in the fintech niche" joins
`user_skills` × `user_specializations` × `user_rate_settings`.

## Storage of identity documents

`user_identity_documents.storage_key` points into the **private Cloudflare R2
bucket** (`proyekto-private`) — never publicly reachable, served only via
short-lived presigned GETs. The `uploads` module routes `identity_documents` (and
`payout_proofs`) to the private bucket. See [Storage & Media](../08-storage-media/README.md).

> Older identity docs described these as a "private **Supabase Storage** bucket."
> That's stale — storage moved to R2.

## Access rules (RLS)

RLS is enabled on all of these tables. The consistent pattern (see
[rls-and-security.md](./rls-and-security.md)):

| Table(s) | SELECT | Write |
| --- | --- | --- |
| The public sub-entities (`user_skills`, `user_languages`, `user_educations`, `user_certifications`, `user_licenses`, `user_experiences`, `user_portfolios`, `user_specializations`, `user_rate_settings`) | Public (shown on profiles) | Owner only |
| `user_verifications` | Owner + admin | Admin only |
| `user_identity_documents` | Owner + admin | Owner (upload) + admin (verify) |
| `user_stats` | Any authenticated user | Service role only (updated on project completion) |
| `consultant_profiles`, `freelancer_profiles` | Owner + admin | Service role/admin only; owners use lifecycle APIs rather than direct writes |
| `skills`, `languages` | Public | Service role only |

In practice the backend runs as the service role and enforces these rules in the
service layer; RLS is defense-in-depth.

## The vetting flow

1. A user applies to become a verified Consultant → a `consultant_applications` row
   (`application_status`) plus their `user_verifications` records.
2. An admin reviews the full identity (all `user_*` tables) in the admin console and
   sets each required `user_verifications.status = 'verified'`.
3. Approval provisions the personal team first, then upserts
   `consultant_profiles.status='verified'`, records the application and reviewing
   admin, and marks the application approved. An approved legacy consultant without
   an application remains valid because `application_id` is nullable.
4. Admins may suspend, reinstate, revoke, or later re-approve the retained enrollment
   row. `ConsultantOnlyGuard` and `is_active_consultant()` accept only `verified`;
   execution authorization never reads enrollment state.

Freelancer enrollment is separate and self-service. `POST /marketplace/go-live`
enforces identity, rate-card, portfolio, and basic-profile eligibility before it
upserts an `active` row. `POST /marketplace/pause` changes it to `paused`; resuming
runs the eligibility check again. Only active rows appear in discovery or pass the
invite-by-id precondition.

The admin-side procedure is the [Admin vetting playbook](../12-runbooks/README.md);
the backing modules are `profile`, `applications`, and `admin`
([Backend → modules](../03-backend/modules.md)).

## Source

DDL starts at [`supabase/migrations/20260226000000_identity_vetting_schema.sql`](../../supabase/migrations/)
and includes the 2026-08-12 marketplace enrollment expand/contract migrations. See
[schema-overview.md](./schema-overview.md) for the whole schema.
