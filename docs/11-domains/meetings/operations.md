# Operations & runbook

> **Last updated:** 2026-07-09 · **Status:** current

Migrations, deploy, secrets, QA, and troubleshooting for the meetings feature.

## Environment

| | |
| --- | --- |
| **Web** | Vite dev on `:3000`; prod served from the web frontend host |
| **Backend** | NestJS on Cloud Run, `api.proyekto.tech`; local dev on `:8001` (`cd backend && npm run dev`) |
| **DB** | Supabase Postgres (Singapore), project ref `byvbnkpiselvvulsvxgo` |
| **GCP** | project `planar-rarity-494104-n4`, region `asia-southeast1`, service `proyekto-backend`, runtime SA `proyekto-backend-sa@…` |

## Migrations

Source of truth: [`supabase/migrations/`](../../../supabase/migrations/) (repo root).
Apply to prod SG via the **Supabase MCP `apply_migration`** — `supabase db push`
fails SASL auth because the local `backend/.env` password is the old Mumbai DB's,
not SG's.

Meeting migrations, in order:

```
20260706120000_revive_meetings_scheduling.sql      enums, meetings, participants, RLS
20260706120100_add_consultation_meeting_type.sql   'consultation' enum value
20260708130000_meetings_location_reminder.sql      location + reminder_minutes
20260708140000_meetings_recurrence.sql             meeting_series + recurrence cols/indexes/RLS
20260708150000_meetings_reminder_delivery.sql      reminder_sent_at + partial index
```

All are **applied to prod SG**. Verify a column/index:

```sql
select count(*) from information_schema.columns
  where table_name='meetings' and column_name='reminder_sent_at';
select count(*) from pg_indexes where indexname='idx_meetings_reminder_due';
```

## Deploy

Push to `main` → GitHub Actions:

- **`backend-deploy.yml`** — builds the image, `gcloud run deploy` with
  `--set-secrets`. Reminder secret is gated on the `MEETINGS_REMINDERS_ENABLED`
  repo var. **Cloud Run's `--set-secrets` full‑replaces**, so any new secret must
  be in the workflow's `SECRETS` list (the deployer SA can't `describe` secrets, so
  additions are unconditional or repo‑var‑gated — never `gcloud secrets describe`
  gated).
- **`mobile-ota-deploy.yml`** — publishes the web bundle for the mobile app's OTA
  live‑updates.

> A `--update-secrets` / `--set-env-vars` **rolls a new revision but does NOT
> rebuild the image** — new *code* only reaches prod via a real deploy (push to
> `main`). If the cron endpoint returns 404 after mounting the secret, the code
> isn't deployed yet.

## Secrets

| Secret | Where | Notes |
| --- | --- | --- |
| `MEETINGS_CRON_SECRET` | Secret Manager + Cloud Run + `backend/.env` | reminder cron auth; see [reminders.md](./reminders.md#provisioning-gcp) |
| `JITSI_BASE_URL` | env (default `https://meet.jit.si`) | auto‑generated video rooms |
| `SUPABASE_*`, `GMAIL_*`, `R2_*`, … | Secret Manager | general backend |

`MEETINGS_CRON_SECRET` and `MEETINGS_REMINDERS_ENABLED` are validated in
[`env.validation.ts`](../../../backend/src/config/env.validation.ts) (optional).

## Reminder cron runbook

See [reminders.md](./reminders.md) for full provisioning. Quick ops:

```bash
# health (0 due is normal)
curl -s -X POST https://api.proyekto.tech/api/meetings/cron/reminders \
  -H "x-cron-secret: $(gcloud secrets versions access latest \
      --secret=MEETINGS_CRON_SECRET --project=planar-rarity-494104-n4)" -d ''
# scheduler
gcloud scheduler jobs describe meetings-reminders --location=asia-southeast1
gcloud scheduler jobs run     meetings-reminders --location=asia-southeast1   # force
gcloud scheduler jobs pause   meetings-reminders --location=asia-southeast1   # stop
# rotate the secret
NEW=$(openssl rand -hex 32)
printf '%s' "$NEW" | gcloud secrets versions add MEETINGS_CRON_SECRET --data-file=-
# then redeploy backend (mounts :latest) AND update the scheduler header to $NEW
```

## QA driver

[`web/playwright/meetings-qa.mjs`](../../../web/playwright/meetings-qa.mjs) — a headed
Playwright driver that exercises every Phase 0–3 capability end‑to‑end and asserts
the correctness‑critical bits against the backend API (not just the DOM).

```bash
cd web
npm run pw:install         # once
npm run pw:auth            # refresh the stored Supabase session (playwright/.auth/user.json)
node playwright/meetings-qa.mjs      # headed, slowMo 800ms
```

Prereqs: web on `:3000`, **backend restarted on `:8001`** with the current code,
fresh auth session. It:

- drives all four views + navigation;
- creates a one‑off in `Australia/Sydney` and asserts `scheduled_at` lands on the
  **exact** UTC instant;
- creates a weekly `America/New_York` series and asserts the **53 instances** share
  a `series_id`, and that the wall‑clock stays **09:00 across the Nov DST boundary**
  (13:00Z EDT → 14:00Z EST);
- builds a custom "every 2 weeks ×5" rule;
- performs scoped **edit "this"** (detach) and **cancel "this"** via `ScopeDialog`;
- cleans up: every test meeting is titled `[QA] …` and cancelled at the end.

Artifacts land in `C:/tmp/meetings-qa/` (per‑step PNGs, a `.webm`, and
`summary.md`). Prints a PASS/FAIL table; exits non‑zero on any failure.

Selector notes for future edits (there are **no `data-testid`s** in the meetings
tree): toolbar "Create" needs `exact:true` (else it matches the time‑grid slot
buttons); the `TimePicker` input is `getByRole('textbox', {name})` (the popover
shares the aria‑label); the `DatePickerField` trigger has no aria‑label (target its
`svg.lucide-calendar`); tz option labels keep the slash (`Australia/Sydney`); a
month chip is a `button button` nested inside the day‑cell button.

## Unit tests

```bash
cd backend && npx jest src/modules/meetings/          # service (12) + recurrence (7)
cd web     && npm test                                # recurrence, datetime, overlap/layout
```

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Meeting lands at the wrong time | Client used `new Date(localString)` instead of `wallTimeToUtcISO`; or the `timezone` wasn't sent. |
| Recurring instance drifts across DST | Expansion not done in floating space — must be `expandOccurrences` (floating) + `fromZonedTime` per occurrence. |
| `409 Conflict` on create | `assertHostFree` overlap guard — the host already has a scheduled meeting at that instant. |
| Series create returns fewer instances than expected | Slot collisions (`uq_meetings_host_slot`) skipped by `insertInstanceIgnoreConflict`, or the horizon/`MAX_OCCURRENCES` cap. |
| Cron endpoint `401 "not configured"` | `MEETINGS_CRON_SECRET` not set in the running process (needs a deploy/restart with the env). |
| Cron endpoint `404` | New code not deployed — `--update-secrets` doesn't rebuild the image; push to `main`. |
| Cron endpoint `411` on manual curl | Bodyless POST — add `-d ''`. |
| Reminder never fires | Meeting has no `reminder_minutes`, `reminder_sent_at` already set, meeting not `scheduled`, or the Scheduler is paused. |
| Duplicate reminders | Should be impossible (atomic `claimReminders`); check the partial index + that nothing bypasses `dispatchReminders`. |

## Not yet wired

- **Horizon top‑up cron** — open‑ended series materialize 365 days ahead at
  creation; the `materialized_until` watermark exists for a top‑up job, but the
  external trigger isn't set up. A never‑ending series won't auto‑extend past a
  year until it lands.
- **Editing a series' repeat *pattern*** (e.g. weekly→daily) from the UI — scoped
  edits change fields/time, not the rule; a recurring occurrence shows a static
  "Recurring event".
- **Guest email delivery** — external `guest_emails` are recorded and invited
  in‑app to accounts, but not emailed.
- **Real Google Calendar/Meet OAuth** (Phase 5) — `google_meet` provider +
  `google_event_id` are reserved; the branded picker is display‑only for now.
