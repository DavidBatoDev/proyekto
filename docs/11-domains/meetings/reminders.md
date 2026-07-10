# Reminders

> **Last updated:** 2026-07-09 · **Status:** current

Deliver a `meeting_reminder` notification to every participant of a meeting,
**once**, at the meeting's `reminder_minutes`‑before offset.

Serverless Cloud Run has no long‑lived process, so delivery is **poll‑based**: an
external scheduler hits a guarded backend endpoint every minute; the backend scans
for due meetings and emits notifications. Everything is idempotent and race‑safe.

## Flow

```
Cloud Scheduler (every minute)
   │  POST https://api.proyekto.tech/api/meetings/cron/reminders
   │  header: x-cron-secret: <MEETINGS_CRON_SECRET>
   ▼
CronSecretGuard  ── wrong/absent secret ──► 401
   │ ok
   ▼
MeetingsService.dispatchReminders()
   1. findReminderCandidates(now, now + 4 weeks)
        → scheduled, reminder_minutes set, reminder_sent_at IS NULL,
          scheduled_at in (now, now+4w]
   2. filter to DUE:  scheduled_at − reminder_minutes·60s ≤ now
   3. claimReminders(dueIds)              ← atomic UPDATE … SET reminder_sent_at
        RETURNING id                        WHERE reminder_sent_at IS NULL
   4. for each CLAIMED meeting:
        notifyMany(participants with a user_id, 'meeting_reminder')
   → 200 { data: { due, notified } }
```

- **Idempotent** — `reminder_sent_at` is stamped once; a meeting can't be reminded
  twice.
- **Race‑safe** — the claim is a conditional `UPDATE … WHERE reminder_sent_at IS
  NULL RETURNING id`, so if two ticks overlap, only one wins each row; only claimed
  rows are notified.
- **Guests skipped** — participants without a `user_id` (email‑only) get no in‑app
  notification (emailing guests is future work).
- **Best‑effort** — `notifyMany` swallows per‑recipient errors; a failed push never
  blocks the scan. Each in‑app notification also fires a best‑effort FCM push.

## Idempotency marker

Migration
[`20260708150000_meetings_reminder_delivery.sql`](../../../supabase/migrations/20260708150000_meetings_reminder_delivery.sql):

```sql
alter table public.meetings add column if not exists reminder_sent_at timestamptz;

create index if not exists idx_meetings_reminder_due
  on public.meetings (scheduled_at)
  where status='scheduled' and reminder_minutes is not null and reminder_sent_at is null;
```

The partial index keeps the every‑minute scan cheap (only upcoming, unsent,
reminder‑configured rows are indexed).

## The endpoint & its guard

`POST /api/meetings/cron/reminders` — `@Public()` (skips the Supabase JWT guard) +
`@UseGuards(CronSecretGuard)`.

[`CronSecretGuard`](../../../backend/src/common/guards/cron-secret.guard.ts) reads the
`x-cron-secret` header and compares it (constant‑time) to the
`MEETINGS_CRON_SECRET` env var:

- secret **unset** → `401 "Cron endpoint is not configured."` (secure by default —
  reminders simply aren't delivered until it's provisioned)
- header mismatch/absent → `401 "Invalid cron secret."`

## Provisioning (GCP)

The endpoint + logic ship with the backend; the **trigger + secret** are infra.
Project `planar-rarity-494104-n4`, region `asia-southeast1`, service
`proyekto-backend`, runtime SA `proyekto-backend-sa@…`.

### 1. Secret in Secret Manager (+ local `.env`)

```bash
# generate + store
SECRET=$(openssl rand -hex 32)
printf '%s' "$SECRET" | gcloud secrets create MEETINGS_CRON_SECRET \
  --project=planar-rarity-494104-n4 --replication-policy=automatic --data-file=-
gcloud secrets add-iam-policy-binding MEETINGS_CRON_SECRET \
  --project=planar-rarity-494104-n4 \
  --member="serviceAccount:proyekto-backend-sa@planar-rarity-494104-n4.iam.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
# local dev
echo "MEETINGS_CRON_SECRET=$SECRET" >> backend/.env
```

### 2. Mount on Cloud Run (durable)

The deploy workflow ([`backend-deploy.yml`](../../../.github/workflows/backend-deploy.yml))
adds the secret to `--set-secrets` **gated on a repo variable**, mirroring the
OTA/Realtime pattern (so a deploy never fails if the secret isn't created yet):

```bash
gh variable set MEETINGS_REMINDERS_ENABLED --body true    # from the repo dir
```

The next deploy mounts `MEETINGS_CRON_SECRET`. To apply immediately without a
deploy: `gcloud run services update proyekto-backend --region=asia-southeast1 \
  --update-secrets=MEETINGS_CRON_SECRET=MEETINGS_CRON_SECRET:latest`.

### 3. Cloud Scheduler job

```bash
gcloud services enable cloudscheduler.googleapis.com --project=planar-rarity-494104-n4
gcloud scheduler jobs create http meetings-reminders \
  --project=planar-rarity-494104-n4 --location=asia-southeast1 \
  --schedule="* * * * *" --time-zone="Etc/UTC" \
  --uri="https://api.proyekto.tech/api/meetings/cron/reminders" \
  --http-method=POST --attempt-deadline=60s \
  --headers="x-cron-secret=$(gcloud secrets versions access latest \
      --secret=MEETINGS_CRON_SECRET --project=planar-rarity-494104-n4)"
```

The secret sits in the job's header config (visible only to those who can already
read Secret Manager). For zero secret‑in‑config, switch to **OIDC**
(`--oidc-service-account-email`) and verify a Google‑signed token in the guard
instead — a future hardening option.

## Verify

```bash
SECRET=$(gcloud secrets versions access latest --secret=MEETINGS_CRON_SECRET \
  --project=planar-rarity-494104-n4)
# with secret → 200 { "data": { "due": N, "notified": M } }
curl -s -X POST https://api.proyekto.tech/api/meetings/cron/reminders \
  -H "x-cron-secret: $SECRET" -d '' -w '\nHTTP %{http_code}\n'
# wrong secret → 401
curl -s -o /dev/null -X POST https://api.proyekto.tech/api/meetings/cron/reminders \
  -H "x-cron-secret: wrong" -d '' -w 'HTTP %{http_code}\n'
# force a run
gcloud scheduler jobs run meetings-reminders --location=asia-southeast1
```

> A **bodyless** `curl -X POST` gets `411 Length Required` from Google's frontend —
> add `-d ''`. Cloud Scheduler sends a proper request, so this only affects manual
> curls.

## Current status

**Live in production** (2026‑07‑08): secret provisioned, mounted on Cloud Run,
`MEETINGS_REMINDERS_ENABLED=true`, Cloud Scheduler `meetings-reminders` firing
every minute; endpoint returns `200`. See [operations.md](./operations.md).

## Tuning

| Knob | Where | Default |
| --- | --- | --- |
| Scan look‑ahead | `REMINDER_SCAN_AHEAD_MS` in `meetings.service.ts` | 40320 min (4 weeks = max reminder offset) |
| Reminder offsets offered | `REMINDER_OPTIONS` in `MeetingEditorModal.tsx` | 5m / 10m / 15m / 30m / 1h / 1d |
| Poll cadence | Cloud Scheduler `--schedule` | `* * * * *` (every minute) |
| Max reminder offset | `MAX_REMINDER_MINUTES` in `meeting.dto.ts` | 40320 |
