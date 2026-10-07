# Google Calendar / Meet integration

> **Last updated:** 2026-10-07 · **Status:** current · off unless `GOOGLE_OAUTH_ENABLED=true`

Per‑user Google Calendar / Meet OAuth (meetings **Phase 5**), Proyekto's calendar
integration. A user connects their own Google account once (Settings →
Integrations, the Meetings toolbar, or the editor); thereafter:

- choosing **Google Meet** in the event editor makes the backend create a real
  **Google Calendar event with a Meet conference link** on the organizer's
  calendar — with guests added as **attendees who receive Google Calendar
  invites** — and stores the `google_event_id` so later edits and cancels
  propagate back to Google;
- the Meetings calendar overlays the user's **own primary‑calendar events**,
  read‑only, read live from Google on each view and **never stored** (the
  privacy policy's "Google user data" section promises exactly this).

The feature is **invisible unless enabled**: unless `GOOGLE_OAUTH_ENABLED` is
set *and* the OAuth client secrets are present, `GoogleOAuthService.isEnabled()`
is false, the `GET /google/status` route returns `enabled:false`, and the editor
hides the Google Meet option entirely. This mirrors the reminders / FCM / OTA /
Realtime dark‑ship pattern.

## Scope

- **One‑off and recurring** meetings. A series maps to **one native Google
  recurring event** (the RRULE is sent to Google); every materialized instance
  shares that one `google_event_id` and Meet link.
- **Attendees invited** — guest emails + resolved participant emails are added
  with `sendUpdates=all`, so Google emails real calendar invites.
- Only the meeting's **organizer/host** needs to be connected; the event is
  created on their calendar.
- **Raw `fetch`** to Google endpoints (no `googleapis` dependency) — mirrors the
  existing Gmail integration in
  [`auth/email-otp.service.ts`](../../../backend/src/modules/shared/auth/email-otp.service.ts).

## OAuth flow

```
Editor → "Connect Google Calendar"
   │  GET /api/meetings/google/connect        (Supabase JWT)
   ▼
GoogleOAuthService.buildConsentUrl(userId)
   • state = uuid  →  Redis  gcal:oauth:state:{state} = userId  (ex 600s)
   • returns accounts.google.com consent URL
     (scope calendar.events + openid email, access_type=offline, prompt=consent)
   │  browser redirects to Google, user consents
   ▼
GET /api/meetings/google/callback?code&state          (@Public — no JWT)
   • state → userId (Redis, consumed)
   • POST oauth2.googleapis.com/token (authorization_code)
   • store { google_email, refresh_token (ENCRYPTED) } in google_calendar_connections
   • 302 → ${CLIENT_URL}/meetings?google=connected
   ▼
/meetings route shows a toast, invalidates the google-status query
```

At event‑create time the backend mints an access token on demand:
`GoogleOAuthService.getAccessToken(userId)` decrypts the refresh token and POSTs
a `grant_type=refresh_token` exchange (per request — a single Calendar call
follows), then `GoogleCalendarService` calls the Calendar REST API.

## Endpoints (`GoogleController`, routes under `/api/meetings/google`)

| Method & path | Guard | Purpose |
| --- | --- | --- |
| `GET /google/status` | Supabase JWT | `{ enabled, connected, googleEmail? }` — drives the editor UI |
| `GET /google/connect?returnTo=` | Supabase JWT | `{ url }` consent URL; the SPA does `window.location = url`. `returnTo` is clamped to `/meetings` or `/settings/integrations` |
| `GET /google/events?from&to` | Supabase JWT + `UserThrottlerGuard` (60/min) | `{ connected, events[] }` — the read‑only overlay (see below); `Cache-Control: no-store`; window ≤ 186 days |
| `GET /google/callback` | `@Public()` | Google's redirect — exchange + store, then 302 to `${CLIENT_URL}${returnTo}?google=connected\|error[&reason=denied\|expired\|failed]` |
| `DELETE /google/connection` | Supabase JWT | Revoke at Google (best‑effort) + delete the row + drop the cached access token |

The callback is `@Public()` because Google redirects with no Supabase session;
the user (and the page to return to) is recovered from the Redis‑stored `state`
(`{userId, returnTo}` JSON; a legacy bare‑userId value is still accepted). A
cancelled consent (`error=access_denied`) returns with `reason=denied`; the
callback logs any other failure.

## Reading events (the overlay)

`MeetingsService.listGoogleEvents(userId, {from, to})` →
`GoogleCalendarService.listEvents` calls `GET calendars/primary/events` with
`singleEvents=true` (recurring events expanded), `orderBy=startTime`, a `fields`
mask, and pages of 250 up to 4 pages (1,000 events). Cancelled occurrences are
dropped; items map to `GoogleCalendarEvent {id, recurringEventId, title, start,
end, allDay, location, htmlLink, meetUrl, free}` (all‑day events keep Google's
date‑only form with an exclusive end day).

**No duplicates:** events whose `id` or `recurringEventId` equals the
`google_event_id` of a meeting the user already sees (`repo.listForUser` over the
window ±1 day) are filtered out. This works for invitees too, because Google
keeps one event id across every attendee's calendar, and every occurrence of a
mirrored series carries the series' master id as `recurringEventId`.

**Nothing is stored:** event contents are never cached (only the access token —
next section), and the response is `no-store`. The web keeps them in TanStack
Query memory for 60 s.

### Tokens and revoked grants

`GoogleOAuthService.getAccessToken` caches the minted access token, encrypted with
`GOOGLE_TOKEN_ENC_KEY`, in Redis at `gcal:token:{userId}` until 60 s before
`expires_in`; `GoogleCalendarService` drops it and retries once on a Google
`401`. When Google answers the refresh with `invalid_grant` (the user revoked
access, the grant expired, or a password change), the service **deletes the
connection row and the cached token** and throws `GoogleReconnectRequiredError` —
a `409` with `code: 'GOOGLE_RECONNECT_REQUIRED'`. Status then reports
`connected:false`, so every surface offers Connect again. `provisionVideo` lets
that `409` through (it used to become a `502`); best‑effort edits (`safeGoogle`)
still swallow it. The redirect URI
(`GOOGLE_OAUTH_REDIRECT_URI`) must be `https://api.proyekto.tech/api/meetings/google/callback`
(note the `/api` prefix) and registered verbatim on the Google OAuth client.

## Data model

New migration
[`20260711100000_google_calendar_connections.sql`](../../../supabase/migrations/20260711100000_google_calendar_connections.sql):

- **`public.google_calendar_connections`** — one row per user (`UNIQUE(user_id)`):
  `google_email`, `refresh_token` (**encrypted at rest**), `scope`, `token_type`,
  `connected_at`, `updated_at`. Modeled on `device_tokens`; the backend upserts as
  the service role (`onConflict: user_id`).
- **RLS** — enabled, INSERT/UPDATE/DELETE owner‑scoped. **No SELECT policy** — the
  encrypted `refresh_token` must never be readable via PostgREST; connection
  status is served only by `GET /google/status`.
- **`meeting_series.google_event_id`** — new column holding the shared master
  event id (the base `meetings.google_event_id text` column already existed and
  is now read/written). Both are surfaced in `MEETING_COLUMNS` / `SERIES_COLUMNS`
  and the repository interfaces.

### Refresh‑token encryption

Refresh tokens are encrypted with **AES‑256‑GCM** before storage
([`token-crypto.ts`](../../../backend/src/modules/execution/meetings/google/token-crypto.ts)),
keyed by a base64 32‑byte `GOOGLE_TOKEN_ENC_KEY`. Stored form:
`gcmv1:<iv>:<tag>:<ciphertext>`. If the key is unset (local/dark), tokens are
stored as plaintext with a one‑time warning — **set the key in production.**

## Sync matrix (`MeetingsService` ↔ Google)

`resolveVideo` stays synchronous for `none`/`external_link` (legacy `jitsi`
input resolves to `none` — see [backend-api.md](./backend-api.md)).
`provisionVideo` handles `google_meet`: it validates the organizer is connected,
resolves attendee emails, and creates the Google event **before** the DB insert
(orphan‑cleaned if the insert fails).

| Meetings action | Google Calendar operation | Failure policy |
| --- | --- | --- |
| `create()` one‑off | `events.insert` (Meet + attendees) | **Fail‑loud** — not connected → `400`, API error → `502`; delete the event if the DB insert then fails |
| `createSeries()` | one recurring `events.insert` (RRULE); id copied to every instance | Fail‑loud + orphan cleanup |
| `cancel()` `all` | `deleteEvent(master)` | Best‑effort |
| `cancel()` `following` | `truncateSeriesUntil(master, occurrence − 1s)` | Best‑effort |
| `cancel()` `this` / one‑off | series → `cancelInstance`; one‑off → `deleteEvent` | Best‑effort |
| `updateDetails()` `this` / standalone | series instance → `patchInstance`; else `patchEvent`; attendee diffs re‑PATCH | Best‑effort |
| `updateSeriesAll()` | one `patchEvent(master, summary/start/recurrence/attendees)` | Best‑effort |
| `updateSeriesFollowing()` | `truncateSeriesUntil(old master)` + a **new** recurring event (new Meet link) | New event fail‑loud; truncate best‑effort |
| `reschedule()` | one‑off → `patchEvent(master, {start,end})`; series instance → `patchInstance` | Best‑effort |

**Why the split:** create is fail‑loud (the user explicitly picked Google Meet —
silently saving the meeting with no video link would change the contract). Edit/cancel/reschedule
propagation is best‑effort — the DB is the source of truth, so a stale Google
event never blocks a cancel; failures are swallowed and logged (mirrors
`notifyMany`).

**Accepted edge behaviors:** (a) a *this‑and‑following* edit gives the new
sub‑series a **new** Meet link (it's a new Google event); (b) rescheduling a
single **series instance** detaches it to a standalone DB row with `google_event_id`
left unlinked (so a later cancel can't delete the whole series master) while the
occurrence is moved on Google via `patchInstance`; (c) switching a **series'**
provider *to or from* Google Meet on an in‑place edit is rejected (`400`) —
recreate the series.

Key files:
[`google/google-oauth.service.ts`](../../../backend/src/modules/execution/meetings/google/google-oauth.service.ts),
[`google/google-calendar.service.ts`](../../../backend/src/modules/execution/meetings/google/google-calendar.service.ts),
[`google/google.controller.ts`](../../../backend/src/modules/execution/meetings/google/google.controller.ts),
[`meetings.service.ts`](../../../backend/src/modules/execution/meetings/meetings.service.ts)
(`provisionVideo` / `resolveVideoForEdit` / `propagateGoogleForOccurrence` / `safeGoogle`).

## Frontend

- **Settings → Integrations**
  ([`routes/settings/integrations.tsx`](../../../web/src/routes/settings/integrations.tsx))
  is the home of the connection: status, the connected Google email, **Connect**
  (`returnTo=/settings/integrations`), and **Disconnect** behind an in‑page
  confirm that lists what disconnecting does. It says so when `enabled` is false.
- **Meetings calendar**
  ([`CalendarShell.tsx`](../../../web/src/components/meetings/calendar/CalendarShell.tsx)):
  when connected, `useGoogleCalendarEvents(range)` fetches the overlay for the
  same window as the meetings query (skipped in the year view). Its loading and
  error state never gate the meetings. A toolbar **Google Calendar** button
  shows or hides the overlay (`localStorage` `meetings.showGoogleCalendar`,
  try/catch); when not connected the toolbar offers **Connect Google Calendar**
  instead. Placement lives in
  [`googleEvents.ts`](../../../web/src/components/meetings/calendar/googleEvents.ts)
  (all‑day, overnight clipping, `gcal:`‑namespaced layout ids so Google and
  meeting blocks share one overlap layout). `GoogleEventBlock`/`GoogleEventChip`
  draw them outlined and muted; `GoogleEventDetails` shows time, place, **Join
  Google Meet** and **Open in Google Calendar**. The agenda lists them under
  "From Google Calendar".
- **Editor:** the [`VideoProviderPicker`](../../../web/src/components/meetings/editor/VideoProviderPicker.tsx)
  **Google Meet** option renders only when `status.enabled`; disconnected, it
  offers Connect (`returnTo=/meetings`), connected it shows "Connected as
  {email}". `MeetingEditorModal` blocks submit if `google_meet` is selected while
  disconnected; a `409 GOOGLE_RECONNECT_REQUIRED` refetches status.
- **Native app:** Google blocks OAuth in embedded webviews
  (`disallowed_useragent`), so the Capacitor app never starts a connect. It tells
  the user to connect from proyekto.tech in a browser; disconnect still works.
- Shared hooks in [`useMeetings.ts`](../../../web/src/hooks/useMeetings.ts):
  `useGoogleCalendarStatus`, `useGoogleCalendarEvents`,
  `useConnectGoogleCalendar(returnTo)`, `useDisconnectGoogleCalendar`, and
  `useGoogleConnectResult()` (the `?google=` toast + URL cleanup, mounted on both
  return pages).

## Configuration & deploy

Env vars ([`env.validation.ts`](../../../backend/src/config/env.validation.ts), all
optional so the feature stays off until configured; listed in
`backend/.env.example`):

| Var | Notes |
| --- | --- |
| `GOOGLE_OAUTH_ENABLED` | `'true'` to enable (repo var gates the deploy) |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | the Google **Web application** OAuth client |
| `GOOGLE_OAUTH_REDIRECT_URI` | derived on deploy from `PUBLIC_API_URL` |
| `GOOGLE_TOKEN_ENC_KEY` | base64 32‑byte AES key |

> **Namespacing matters.** `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` are already
> read (untyped) by `projects.service.ts` as a Gmail‑send fallback — do **not**
> reuse those names for Calendar OAuth.

The deploy workflow
([`backend-deploy.yml`](../../../.github/workflows/backend-deploy.yml)) mounts the
secrets in a block gated on the `GOOGLE_OAUTH_ENABLED` repo var being exactly
`true` (any other value, including `false`, keeps it off); the redirect URI goes
in `ENV_VARS` (not a secret).

### GCP setup checklist (manual, interactive — one‑time)

1. Enable the **Google Calendar API** in project `planar-rarity-494104-n4`.
2. Configure the **OAuth consent screen**; declare scope
   `.../auth/calendar.events` (+ `openid`, `email`). `calendar.events` is a
   *sensitive* scope. **Decision (2026-10-07):** we do not submit it for
   verification and live within Google's 100‑user lifetime cap for unverified
   sensitive scopes; users see Google's "unverified app" warning and continue via
   Advanced. Branding is verified separately (it covers sign‑in).
3. **Create OAuth client → Web application** — a dedicated "Proyekto Calendar"
   client, not the Supabase sign‑in client. Authorized redirect URIs =
   `https://api.proyekto.tech/api/meetings/google/callback` (exact) and
   `http://localhost:8001/api/meetings/google/callback` for local dev.
4. Provision Secret Manager secrets `GOOGLE_OAUTH_CLIENT_ID`,
   `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_TOKEN_ENC_KEY`
   (`openssl rand -base64 32`); grant the runtime SA `secretAccessor` on each.
5. `gh variable set GOOGLE_OAUTH_ENABLED --body true`; confirm `PUBLIC_API_URL`
   matches the redirect origin. The next deploy mounts everything.

## Verify

- **Unit** (`cd backend && npx jest src/modules/execution/meetings/`): `token-crypto`
  (encrypt↔decrypt, plaintext fallback), `google-calendar.service` (insert
  body/query/headers, RRULE UNTIL normalization, instance‑id derivation, non‑2xx
  throws, 401 retry, `listEvents` query/mapping/paging), `google-oauth.service`
  (consent params, `returnTo` allowlist, state round‑trip incl. legacy form,
  refresh grant, token cache hit/miss, `invalid_grant` → row deleted + `409`,
  disconnect, disabled status), `google.controller` (events window validation,
  callback redirects + reasons), and `meetings.service` google branches
  (disabled/not‑connected → `400`, reconnect → `409`, connected → id+url
  persisted, orphan cleanup, cancel `all`/`this`, best‑effort swallow, overlay
  dedupe).
- **Web** (`cd web && npx vitest run src/components/meetings src/routes/settings`):
  `googleEvents.test.ts` (placement, all‑day, overnight, grouping, layout ids) and
  `integrations.test.tsx` (connect, confirm‑then‑disconnect, disabled, native).
- **End‑to‑end** (OAuth consent is interactive): deploy dark → flip the flag +
  secrets → `GET /google/status` returns `{enabled:true,connected:false}` →
  complete consent as a test user → a `google_calendar_connections` row exists
  with an **encrypted** `refresh_token` → create a one‑off `google_meet` meeting
  with a participant + guest → the row has a real `meet.google.com/…` URL +
  `google_event_id`, the event is on the organizer's calendar, guests are emailed
  → create a series (one recurring event, one link) → scoped edit/cancel propagate
  → `DELETE /google/connection` → the row is gone and a later `google_meet` create
  returns the "Connect your Google account" `400`.

## Limitations / future work

- **No two‑way sync** — Proyekto → Google is one‑way; changes made *in* Google
  don't flow back. Propagation is best‑effort with no reconciliation cron (yet).
- **Guest email delivery** for non‑Google‑Meet meetings is still in‑app only;
  only the Google path emails invites (via `sendUpdates=all`).
- **Overlay scope** — only the **primary** calendar is read (listing other
  calendars would need a new scope and re‑consent), capped at 1,000 events per
  window; the year view shows meetings only.
- **Unverified sensitive scope** — at most 100 users can ever grant
  `calendar.events` until it is verified (the cap never resets).
- **OIDC‑signed Scheduler**, series‑provider switching, and Google‑side exception
  reconciliation are out of scope for this cut.
