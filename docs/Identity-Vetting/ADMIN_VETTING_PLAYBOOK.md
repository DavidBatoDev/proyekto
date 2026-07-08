# Admin Vetting Playbook

This document describes how an **Admin** uses the Identity & Vetting data to approve a **Consultant** application on Proyekto Work Hub.

---

## The Vetting Pipeline

```
User signs up
      â”‚
      â–¼
Completes profile
(bio, headline, skills, education...)
      â”‚
      â–¼
Submits "Apply as Consultant"
      â”‚
      â–¼
Admin reviews Identity & Vetting data
      â”‚
      â”œâ”€â”€â”€ Approved â”€â”€â†’ is_consultant_verified = true
      â”‚                 active_persona can now be 'consultant'
      â”‚
      â””â”€â”€â”€ Rejected â”€â”€â†’ user_verifications notes explain why
```

---

## Step-by-Step Admin Review

### Step 1 â€” Identity Checks (`user_verifications`)

The Admin dashboard loads `user_verifications` for the applicant.

| Type | What to check | Approved when |
|---|---|---|
| `email` | Email confirmed in `auth.users` | `status = 'verified'` |
| `phone` | Phone number provided on profile | `status = 'verified'` |
| `identity` | Valid document uploaded to `user_identity_documents` | `status = 'verified'` |

Admin sets each record to `verified` or `failed` with optional notes.

---

### Step 2 â€” Document Review (`user_identity_documents`)

Admin accesses the private storage bucket path from `user_identity_documents.storage_path`.

Checklist:
- Is the document readable and unobscured?
- Does the name match the profile?
- Is it expired? (check `expires_at`)

Admin sets `is_verified = true` and `verified_by = <admin_user_id>` + `verified_at = NOW()`.

---

### Step 3 â€” Credentials (`user_certifications`, `user_licenses`)

Admin scans `user_certifications`:
- For high-trust roles (e.g. Tech Lead): look for cloud certs (AWS, GCP), Scrum certifications
- Use `credential_url` to verify badge authenticity on the issuer's website
- Set `is_verified = true` for confirmed certs

Admin scans `user_licenses` for regulated projects (Legal, Engineering, Healthcare).

---

### Step 4 â€” Skills & Niche Fit (`user_skills`, `user_specializations`)

Admin cross-references:
1. Which `skills` does the applicant claim at `expert` proficiency?
2. Which `user_specializations` categories do they target?
3. Does their `user_experiences` employment history support those claims?

**Matchmaking hint:** The `user_specializations.category` field is the primary filter used when Admins assign a Consultant to a newly posted client project.

---

### Step 5 â€” Track Record (`user_stats`, `user_portfolios`)

- `user_stats.avg_rating` and `jobs_completed` reflect their platform history (for returning users)
- `user_portfolios` provides visual evidence (screenshots, live URLs) for new applicants with no platform history

---

### Step 6 â€” Rate Card (`user_rate_settings`)

Admin checks that the applicant has set a realistic `hourly_rate` and `availability`. This data is used when presenting Consultant options to new Clients.

---

### Step 7 â€” Approval

Once all checks pass:

```sql
UPDATE public.profiles
SET is_consultant_verified = true
WHERE id = '<applicant_user_id>';
```

The user can now switch their `active_persona` to `'consultant'` and be assigned to projects.

---

## Rejection Flow

If the application fails at any step:

```sql
UPDATE public.user_verifications
SET status = 'failed',
    notes  = 'Document appears altered. Please resubmit with a valid passport.'
WHERE user_id = '<applicant_id>'
  AND type = 'identity';
```

The user is notified (via app notification / email) and can resubmit.

---

## Matchmaking Query (Future Algorithm)

When assigning a Consultant to a new client project in the `fintech` niche requiring `React` and `TypeScript`:

```sql
SELECT
  p.id,
  p.display_name,
  p.headline,
  us_react.proficiency_level   AS react_level,
  us_ts.proficiency_level      AS ts_level,
  urs.hourly_rate,
  urs.availability,
  stat.avg_rating,
  stat.jobs_completed
FROM profiles p
JOIN user_specializations sp    ON sp.user_id = p.id AND sp.category = 'fintech'
JOIN user_skills us_react       ON us_react.user_id = p.id
JOIN skills s_react             ON s_react.id = us_react.skill_id AND s_react.name = 'React'
JOIN user_skills us_ts          ON us_ts.user_id = p.id
JOIN skills s_ts                ON s_ts.id = us_ts.skill_id AND s_ts.name = 'TypeScript'
LEFT JOIN user_rate_settings urs ON urs.user_id = p.id
LEFT JOIN user_stats stat        ON stat.user_id = p.id
WHERE p.is_consultant_verified = true
  AND urs.availability != 'unavailable'
ORDER BY stat.avg_rating DESC, stat.jobs_completed DESC;
```

