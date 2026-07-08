# Identity & Vetting Domain

## What Is This?

This is the **Identity & Vetting Domain** of Proyekto Work Hub â€” the backbone that answers one question:

> *"Who is this person, and can we trust them with a project?"*

Before a user can manage a project as a **Consultant** or be hired as a **Freelancer**, the platform needs to know their full professional identity. This domain captures that â€” from their education and certifications to their skill set, work history, and rate card.

Think of it as the user's **Passport + Resume + Reputation Score**, all in one structured layer.

---

## Why It Exists

Proyekto is not a raw marketplace like Upwork where anyone can sign up and bid. It is a **managed platform** where:

1. **Clients** submit projects and trust Proyekto to assign qualified help.
2. **Admins** vet and approve Consultants before they can manage any project.
3. **Consultants** must prove their expertise before gaining elevated permissions.

The Identity & Vetting domain is the data infrastructure that makes that vetting possible. Without it, Admins have no structured data to review, and the platform cannot perform skills-based matchmaking.

---

## How It Connects to the Rest of the Platform

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚         Identity & Vetting Domain        â”‚  â† This folder
â”‚  profiles + 13 supporting tables         â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                  â”‚ powers
        â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
        â–¼         â–¼              â–¼
  Admin Vetting  Public      Matchmaking
  Dashboard      Profiles    Algorithm
  (approve       (search,    (skill/niche
  Consultants)   browse)      filtering)
```

The data in this domain is **persona-agnostic** â€” it does not change whether the user is currently acting as a Client or a Freelancer. It is the permanent identity layer.

---

## Domain Map (17 tables â†’ 15 active)

> `linked_accounts` and `user_settings` are deliberately excluded â€” `user_settings` already exists as `profiles.settings` (JSONB), and `linked_accounts` requires a separate OAuth integration phase.

### Domain 1 â€” Core Identity *(The Passport)*

| Table | Purpose |
|---|---|
| [`profiles`](#profiles) | Primary bio: name, headline, avatar, persona, location |

**Key fields added in the Identity & Vetting migration:**
- `headline` â€” short professional tagline (e.g. *"Senior Full-Stack Engineer"*)

---

### Domain 2 â€” Trust & Verification *(The Guardrail)*

> These tables are critical for the Admin to move a user from "Unverified" to "Verified Consultant."

| Table | Purpose |
|---|---|
| [`user_verifications`](#user_verifications) | Tracks email / phone / identity verification status |
| [`user_identity_documents`](#user_identity_documents) | Stores paths to private KYC documents (passports, licenses) |

**Admin workflow:** When a user applies for the Consultant persona, their `user_verifications` record is checked. Admins set `status = 'verified'` for each required type. The application is **only approved** when all required types are `verified`.

---

### Domain 3 â€” Credentials & Authority *(The Proof)*

| Table | Purpose |
|---|---|
| [`user_educations`](#user_educations) | Academic history (degree, institution, years) |
| [`user_certifications`](#user_certifications) | Professional certs (AWS, PMP, Scrum Master, etc.) |
| [`user_licenses`](#user_licenses) | Legal/trade licenses for regulated industries |

---

### Domain 4 â€” Skills & Taxonomy *(The Engine)*

> This is a **Many-to-Many** structure. The master `skills` table (seeded with ~40 common skills) is the single source of truth. JSONB skills on `profiles` has been migrated here.

| Table | Purpose |
|---|---|
| `skills` *(existing)* | Master list of all technical/soft skills |
| [`user_skills`](#user_skills) | Links users to skills with a `proficiency_level` |
| [`languages`](#languages) | Master list of global languages (ISO 639-1, seeded with 16) |
| [`user_languages`](#user_languages) | Links users to languages with a `fluency_level` |

**Why not JSONB?** A `user_skills` join table allows queries like:
```sql
-- Find all Expert Python developers available in the Fintech niche
SELECT p.id, p.display_name
FROM user_skills us
JOIN user_specializations sp ON sp.user_id = us.user_id
JOIN skills s ON s.id = us.skill_id
JOIN profiles p ON p.id = us.user_id
WHERE s.name = 'Python'
  AND us.proficiency_level = 'expert'
  AND sp.category = 'fintech';
```

---

### Domain 5 â€” Work & Reputation *(The Track Record)*

| Table | Purpose |
|---|---|
| [`user_experiences`](#user_experiences) | Employment history (company, title, dates) |
| [`user_portfolios`](#user_portfolios) | Past project showcases (URL, images, tags) |
| [`user_stats`](#user_stats) | Aggregated career stats (earnings, ratings, jobs completed) |

**`user_stats` is write-protected.** Only the service role (backend) can write to it. It is updated automatically when projects complete. Other users can read it for public profile pages.

---

### Domain 6 â€” Financial & Niche *(The Marketplace Filter)*

| Table | Purpose |
|---|---|
| [`user_specializations`](#user_specializations) | Industry niches (Fintech, Healthcare, SaaS, etc.) |
| [`user_rate_settings`](#user_rate_settings) | Rate card: hourly rate, currency, availability, min budget |

---

## Table Schemas

### `profiles`
Extended with:
- `headline TEXT` â€” short professional tagline displayed on public profile pages

All other existing columns remain unchanged.

---

### `user_verifications`
```
id             UUID PK
user_id        â†’ profiles.id
type           ENUM: email | phone | identity
status         ENUM: pending | verified | failed
verified_at    TIMESTAMPTZ
notes          TEXT  (Admin notes, e.g. reason for failure)
```
**Unique constraint:** `(user_id, type)` â€” one row per verification type per user.
**Write access:** Admins only.

---

### `user_identity_documents`
```
id             UUID PK
user_id        â†’ profiles.id
type           ENUM: passport | national_id | drivers_license | other
storage_path   TEXT  (private Supabase Storage bucket path)
is_verified    BOOL
expires_at     DATE
verified_by    â†’ profiles.id (Admin who reviewed it)
```
**Read access:** Owner only + Admins.
**Storage:** Documents are stored in a **private** bucket â€” paths are never publicly accessible.

---

### `user_educations`
```
id               UUID PK
user_id          â†’ profiles.id
institution      TEXT
degree           TEXT       e.g. "Bachelor of Science"
field_of_study   TEXT       e.g. "Computer Science"
start_year       SMALLINT
end_year         SMALLINT
is_current       BOOL
description      TEXT
```

---

### `user_certifications`
```
id               UUID PK
user_id          â†’ profiles.id
name             TEXT       e.g. "AWS Solutions Architect"
issuer           TEXT       e.g. "Amazon Web Services"
issue_date       DATE
expiry_date      DATE
credential_id    TEXT
credential_url   TEXT       (public verification link)
is_verified      BOOL       (Admin-verified badge)
```

---

### `user_licenses`
```
id                  UUID PK
user_id             â†’ profiles.id
name                TEXT
type                ENUM: legal | engineering | medical | financial | real_estate | other
issuing_authority   TEXT
license_number      TEXT
issue_date          DATE
expiry_date         DATE
is_active           BOOL
```

---

### `user_skills`
```
id                UUID PK
user_id           â†’ profiles.id
skill_id          â†’ skills.id
proficiency_level ENUM: beginner | intermediate | advanced | expert
years_experience  SMALLINT
```
**Unique:** `(user_id, skill_id)`.
**Replaces:** `profiles.skills` JSONB (data migrated on creation).

---

### `languages`
```
id     UUID PK
code   CHAR(2)  ISO 639-1 e.g. 'en'
name   TEXT     e.g. "English"
```
Seeded with 16 common global languages. Public read.

---

### `user_languages`
```
id            UUID PK
user_id       â†’ profiles.id
language_id   â†’ languages.id
fluency_level ENUM: basic | conversational | fluent | native
```
**Unique:** `(user_id, language_id)`.

---

### `user_experiences`
```
id           UUID PK
user_id      â†’ profiles.id
company      TEXT
title        TEXT
location     TEXT
is_remote    BOOL
description  TEXT
start_date   DATE
end_date     DATE
is_current   BOOL
```

---

### `user_portfolios`
```
id           UUID PK
user_id      â†’ profiles.id
title        TEXT
description  TEXT
url          TEXT     (live project URL)
image_url    TEXT     (screenshot/thumbnail)
tags         TEXT[]
position     SMALLINT (display order)
```

---

### `user_stats`
```
user_id          UUID PK  â†’ profiles.id
total_earnings   NUMERIC(12,2)
avg_rating       NUMERIC(3,2)   0.00 â€“ 5.00
total_reviews    INTEGER
jobs_completed   INTEGER
jobs_in_progress INTEGER
response_rate    NUMERIC(5,2)   percentage
on_time_rate     NUMERIC(5,2)   percentage
```
**1-to-1 with profiles.** Write access: service role only. Read: any authenticated user.

---

### `user_specializations`
```
id                  UUID PK
user_id             â†’ profiles.id
category            ENUM: fintech | healthcare | e_commerce | saas | education |
                          real_estate | legal | marketing | logistics | media |
                          gaming | ai_ml | cybersecurity | blockchain | other
sub_category        TEXT
years_of_experience SMALLINT
description         TEXT
```
**Unique:** `(user_id, category)`.

---

### `user_rate_settings`
```
user_id            UUID PK  â†’ profiles.id
hourly_rate        NUMERIC(10,2)
currency           CHAR(3)  ISO 4217, default 'USD'
min_project_budget NUMERIC(10,2)
availability       ENUM: available | partially_available | unavailable
weekly_hours       SMALLINT
```
**1-to-1 with profiles.**

---

## RLS Policy Summary

| Table(s) | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| `user_educations`, `user_certifications`, `user_licenses`, `user_skills`, `user_languages`, `user_experiences`, `user_portfolios`, `user_specializations`, `user_rate_settings` | **Public** (visible on profiles) | Owner only (`auth.uid() = user_id`) |
| `user_verifications` | Owner + Admin | Admin only |
| `user_identity_documents` | Owner + Admin | Owner (upload) + Admin (verify) |
| `user_stats` | Authenticated users | Service role only |
| `languages` | Public | Service role only |

---

## Migration Reference

The full DDL lives in:
```
supabase/migrations/20260226000000_identity_vetting_schema.sql
```

This migration:
1. Adds `headline` to `profiles`
2. Creates 13 new tables with all constraints, indexes, triggers and RLS
3. Migrates existing `profiles.skills` JSONB data â†’ `user_skills`
4. Drops `profiles.skills` column
5. Seeds 16 languages into the `languages` table

