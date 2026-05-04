# Slice 1 — Manual verification

> Walkthrough script for verifying the lane-aware signup + `/welcome`
> activation + personal-workspace flow end-to-end on dev. After running each
> scenario, report which step matched / didn't match the expected behavior
> and we'll patch what's broken.

---

## Setup (do once)

1. **Backend running** — `cd backend && npm run dev` on port 8000.
2. **Web running** — `cd web && npm run dev` on port 3000.
3. **Supabase Studio open** in a tab — for DB-level checks. Pin these queries:
   ```sql
   -- Most recent profile + onboarding state
   SELECT id, email, first_name, active_persona, has_completed_onboarding,
          settings->'onboarding' AS onboarding,
          is_consultant_verified
   FROM profiles
   ORDER BY created_at DESC
   LIMIT 5;

   -- Personal workspace check
   SELECT id, title, client_id, consultant_id, is_personal_workspace, status
   FROM projects
   WHERE is_personal_workspace = true
   ORDER BY created_at DESC
   LIMIT 5;

   -- Project_shares for ownership audit
   SELECT id, project_id, user_id, role, origin, granted_at
   FROM project_shares
   ORDER BY granted_at DESC
   LIMIT 10;

   -- Pending invites
   SELECT id, project_id, invitee_email, invited_position, default_role,
          status, created_at
   FROM project_invites
   ORDER BY created_at DESC
   LIMIT 10;
   ```
4. **Two browser sessions ready** — one regular, one incognito. We'll use
   incognito for fresh signups so they don't fight cached auth.
5. **Disposable email service** — Mailosaur, mailinator, or just use
   `+verify1@yourdomain.com` aliases. Each scenario uses a fresh email.
6. **Have the verification code email handy** — the signup sends a 6-digit
   code via the Supabase edge function `send-signup-email`.

> **Tip**: keep this doc + Supabase Studio + the dev server logs visible at
> the same time. You'll need to cross-reference all three on most steps.

---

## Scenario 1 — Client/Freelancer lane, full happy path

The headline scenario. Tests lane wiring, signup, /welcome 4-slide deck,
workspace creation, multi-invite.

### Steps
1. Open **incognito** window → `http://localhost:3000`
2. Click **"I have a project to ship"** in the hero
3. URL should be `/auth/signup?redirect=/&lane=client_freelancer&intent=client`
4. Lane picker (Step 1): **"I'm a client or freelancer"** card should be
   pre-selected (dark border, radio dot filled). Click **Continue**.
5. Account step (Step 2): fill name + email (use a fresh address). Click **Continue**.
6. Password step (Step 3): set password (≥ 8 chars), confirm, Continue.
7. Profile step (Step 4): fill demographic fields, accept terms, Continue.
8. Verify step (Step 5): enter the 6-digit code from email.
9. **Should land on `/welcome` slide 1**, with greeting *"Welcome to
   Proyekto, {firstName}."* (icon: Sparkles, cyan accent).
10. Click **Get started** → slide 2 ("What you can do here").
11. Click **Next** → slide 3 ("Your workspace is ready") — input pre-filled
    with `{firstName}'s Workspace`.
12. **Edit the workspace name** to something different (e.g. `My Test Workspace`).
13. Click **Next** → slide 4 ("Invite your team").
14. Add **2 invite rows**: one with **Editor** role, one with **Viewer**.
    Use plausible emails (don't have to be real users).
15. Click **"Send 2 invites & finish"** → toast "2 invites sent" → land on
    `/dashboard`.

### Expected — UI
- [ ] Lane picker pre-selected the right card
- [ ] All 5 wizard steps had Back/Next at bottom-right (justify-between)
- [ ] No "Step X of Y" stepper UI on signup
- [ ] Logo at top of signup says **Proyekto** (not Prodigitality)
- [ ] /welcome stepper shows 4 dots, advancing with each Next
- [ ] Slide 3 input is editable; default value is `{firstName}'s Workspace`
- [ ] Slide 4 has Editor/Viewer toggle per row + "+ Add another"

### Expected — DB
Run the pinned queries:
- [ ] `profiles.active_persona = 'client'`
- [ ] `profiles.has_completed_onboarding = true`
- [ ] `profiles.settings.onboarding.lane = 'client_freelancer'`
- [ ] `profiles.settings.onboarding.intent = { client: true, freelancer: false }`
- [ ] `projects` row exists: `is_personal_workspace = true`, `client_id = <user.id>`, `consultant_id = NULL`, title matches what you typed in slide 3
- [ ] `project_shares` row exists: `role = 'owner'`, `origin = 'personal_workspace'`
- [ ] **2 rows** in `project_invites`: `status = 'pending'`, `default_role` matches what you picked per row (one `editor`, one `viewer`)

---

## Scenario 2 — Skip-invite path

Same as Scenario 1 but skips the invite step. Verifies the skip path doesn't
write any invite rows.

### Steps
1. Repeat scenario 1 steps 1–13 with a **new email**.
2. On slide 4, click **"Skip for now"** (don't add any invites).
3. Land on `/dashboard`.

### Expected
- [ ] No toast about invites sent
- [ ] **0 rows** in `project_invites` for this user
- [ ] Personal workspace still created (workspace title = default `{firstName}'s Workspace`)

---

## Scenario 3 — Consultant lane, full happy path

Tests the consultant 3-slide deck and the `/consultant/apply` redirect.

### Steps
1. Incognito → `/consultant` (or click "Apply as a consultant" in header chip)
2. Click **"Apply to lead on Proyekto"** in the hero
3. URL should be `/auth/signup?redirect=/consultant/apply&lane=consultant`
4. Lane picker: **"I'm applying as a consultant"** card pre-selected. Continue.
5. Complete account, password, profile, verify steps (fresh email).
6. **Should land on `/welcome` slide 1** with Crown icon (amber) + greeting.
7. Click **Get started** → slide 2 ("What you're applying for") — 3 benefit cards.
8. Click **Next** → slide 3 ("What to expect") — 3 expectation rows.
9. Click **"Start application"** → land on `/consultant/apply`.

### Expected — UI
- [ ] Slide 1 uses Crown icon with amber accent (different from C/F welcome)
- [ ] Stepper shows 3 dots (not 4)
- [ ] Footer link reads *"Want to use Proyekto as a client first? Open my workspace →"*
- [ ] Slide 3 CTA reads **"Start application"** (not "Finish")
- [ ] Lands on `/consultant/apply` — the 5-step application form

### Expected — DB
- [ ] `profiles.active_persona = 'freelancer'` (not consultant — that flips on approval)
- [ ] `profiles.settings.onboarding.lane = 'consultant'`
- [ ] `profiles.is_consultant_verified = false`
- [ ] Personal workspace **still provisioned** (consultants get one too per soft-isolation)

---

## Scenario 4 — Consultant close-confirm on slide 1

Tests the consultant-specific close-confirm copy.

### Steps
1. Repeat scenario 3 steps 1–6.
2. On slide 1, click the **X** (top-right of the stepper).
3. Confirm modal should appear with title **"Apply later?"** and copy
   *"You can pick up the application anytime from your dashboard. Your
   workspace is ready in the meantime."*
4. Confirm button label: **"Open workspace"** (not "Skip").
5. Click **Open workspace** → land on `/dashboard`.

### Expected
- [ ] Modal title and copy match the consultant variant
- [ ] Cancel returns to slide 1
- [ ] Confirm routes to `/dashboard`
- [ ] User is unblocked — they can hit `/consultant/apply` later

---

## Scenario 5 — Freelancer secondary CTA

Tests that the homepage's "I'm looking for freelance work" button records
freelancer intent.

### Steps
1. Incognito → home → click **"I'm looking for freelance work"**
2. Complete signup (any email)
3. Should land on `/welcome` (C/F deck).

### Expected — DB
- [ ] `profiles.settings.onboarding.intent.freelancer = true`
- [ ] `profiles.settings.onboarding.intent.client = false`
- [ ] `profiles.active_persona = 'client'` (intent doesn't auto-promote
      persona — freelancer unlocks via the eligibility checklist later)

---

## Scenario 6 — Lane picker editability

Confirms the user can change the pre-selected lane on Step 1.

### Steps
1. Visit `/auth/signup?lane=client_freelancer` directly.
2. Click the **"I'm applying as a consultant"** card (right side).
3. Continue through signup with a fresh email.
4. After verify, should land on `/consultant/apply` (consultant routing won).

### Expected
- [ ] Lane choice took precedence over the URL param
- [ ] `profiles.settings.onboarding.lane = 'consultant'` (matches the *click*, not the URL)

---

## Scenario 7 — Legacy `/onboarding` redirect

The old `/onboarding` route now redirects (in case any cached email link or
bookmark sends a user there).

### Steps
1. Sign in as **any onboarded user** (e.g. one of the accounts created above).
2. Manually navigate to `http://localhost:3000/onboarding`.

### Expected
- [ ] Browser URL settles on `/welcome` (or `/consultant/apply` if the
      user's lane is `consultant`)
- [ ] No 404, no broken state

---

## Scenario 8 — Returning login with `has_completed_onboarding=false`

Edge case: someone signed up but quit before reaching /welcome. They log
back in — they should land on /welcome (not /dashboard).

### Steps
1. In Supabase Studio, manually flip a profile:
   ```sql
   UPDATE profiles SET has_completed_onboarding = false WHERE email = '<test>';
   ```
2. Log out the test user. Log back in via `/auth/login`.

### Expected
- [ ] After login, lands on `/welcome` (lane-aware)
- [ ] After completing the deck, `has_completed_onboarding` flips back to true

---

## Scenario 9 — Google OAuth callback

OAuth doesn't preserve the `?lane=` query param. Fresh OAuth signups should
default to the C/F welcome deck.

### Steps
1. Incognito → `/auth/signup` (or login) → click **"Continue with Google"**
2. Authenticate with a fresh Google account
3. After OAuth roundtrip, should land on `/welcome` (C/F deck).

### Expected
- [ ] Lands on `/welcome` slide 1, not directly on dashboard
- [ ] `profiles.settings.onboarding.lane = 'client_freelancer'` (default for OAuth)
- [ ] Personal workspace provisioned

> Skip this if you don't have Google OAuth configured on your dev project.

---

## Scenario 10 — Idempotency (no duplicate workspaces)

Verifies the partial unique index actually prevents double-provisioning.

### Steps
1. Pick a user from earlier scenarios.
2. Log out, then log back in (multiple times if you want).
3. Re-run the workspace check query:
   ```sql
   SELECT count(*) FROM projects
   WHERE is_personal_workspace = true AND client_id = '<user.id>';
   ```

### Expected
- [ ] Count stays at exactly **1**, regardless of how many times the user logs in/out.

---

## Other small things to spot-check

- [ ] Mobile layout (375px width) — the lane picker cards stack vertically.
- [ ] Browser back/forward inside the wizard — does state survive?
- [ ] Reload mid-wizard — sessionStorage should preserve the lane and form fields.
- [ ] Re-entering an existing email at signup — should error gracefully ("Email already exists").
- [ ] Brand mark renders on every page (header, footer, signup, /welcome) — no "PRODIGITALITY" leaks.

---

## After you walk through these

Reply with:
- Which scenarios passed cleanly
- Which scenarios broke, and at what step
- Anything that *worked* but felt off (UI weirdness, copy issues, performance)
- Any scenarios that are blocked because of missing infra (e.g. email not arriving)

I'll triage from there — most fixes will be small but anything DB-shape-related might need a follow-up migration.
