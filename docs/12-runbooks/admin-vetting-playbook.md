# Runbook: Admin Vetting Playbook

> **Last updated:** 2026-07-09 · **Status:** current

How an **Admin** uses the identity/vetting data to approve (or reject) a **Consultant**
application. The data model is in
[Data → identity model](../07-data-and-db/identity-vetting-model.md); this is the
operational procedure over it.

```
signs up ─► completes profile ─► "Apply as Consultant"
        ─► admin reviews user_* identity data
             ├─ approve ─► is_consultant_verified = true (can act as consultant)
             └─ reject  ─► user_verifications.notes explain why (user can resubmit)
```

## Step-by-step review

The admin console loads the applicant's `user_*` records. Work through them:

1. **Identity checks** (`user_verifications`) — set `email`, `phone`, `identity`
   each to `verified` or `failed` (with notes). Email is confirmed in `auth.users`;
   identity requires a valid document.
2. **Document review** (`user_identity_documents`) — open the doc from the **private
   R2 bucket** (`proyekto-private`, via a presigned GET) using `storage_key`. Check
   it's readable, the name matches, and it isn't expired (`expires_at`). Set
   `is_verified = true`, `verified_by = <admin_id>`, `verified_at = now()`.
3. **Credentials** (`user_certifications`, `user_licenses`) — verify certs via
   `credential_url`; check licenses for regulated work. Mark confirmed ones verified.
4. **Skills & niche** (`user_skills`, `user_specializations`) — do the claimed
   expert skills and target categories match the `user_experiences` history?
5. **Track record** (`user_stats`, `user_portfolios`) — ratings/jobs for returning
   users; portfolio evidence for new applicants.
6. **Rate card** (`user_rate_settings`) — a realistic `hourly_rate` + `availability`.

> **⚠️ Correction:** older copies described identity docs as a "private **Supabase
> Storage** bucket." Storage moved to **R2** (`proyekto-private`), read via presigned
> GET — see [Storage & Media](../08-storage-media/README.md).

## Approve

Prefer the console action (`POST /admin/applications/:id/approve`), which flips the
capability flag. The underlying effect:

```sql
UPDATE public.profiles SET is_consultant_verified = true WHERE id = '<applicant_id>';
```

The user can then act as `consultant` and be assigned to projects.

## Reject

```sql
UPDATE public.user_verifications
SET status = 'failed', notes = 'Document appears altered. Please resubmit a valid passport.'
WHERE user_id = '<applicant_id>' AND type = 'identity';
```

The user is notified and can resubmit.

## Matchmaking

Assigning a vetted consultant to a project filters primarily on
`user_specializations.category`, then skills/rate/availability/stats. This is a
**shipped** feature (`GET /admin/match-candidates`, `POST /admin/match-assign`) — not
a future algorithm. A representative query:

```sql
SELECT p.id, p.display_name, urs.hourly_rate, stat.avg_rating, stat.jobs_completed
FROM profiles p
JOIN user_specializations sp ON sp.user_id = p.id AND sp.category = 'fintech'
JOIN user_skills us ON us.user_id = p.id
JOIN skills s ON s.id = us.skill_id AND s.name = 'React'
LEFT JOIN user_rate_settings urs ON urs.user_id = p.id
LEFT JOIN user_stats stat ON stat.user_id = p.id
WHERE p.is_consultant_verified = true AND urs.availability != 'unavailable'
ORDER BY stat.avg_rating DESC, stat.jobs_completed DESC;
```

## Code locations

- **Backend:** [`backend/src/modules/admin/`](../../backend/src/modules/admin/), [`backend/src/modules/applications/`](../../backend/src/modules/applications/)
- **Web:** `web/src/routes/admin/`
- **Data model:** [Data → identity model](../07-data-and-db/identity-vetting-model.md)
