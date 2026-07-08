# Architecture

The meetings feature spans three runtimes plus one external scheduler:

```
 ┌────────────┐   HTTPS /api/meetings/*   ┌──────────────┐   service role   ┌──────────────┐
 │   web      │ ────────────────────────► │   backend    │ ───────────────► │  Supabase    │
 │ (React)    │ ◄──────────────────────── │  (NestJS)    │ ◄─────────────── │  Postgres    │
 └────────────┘        { data: … }        └──────────────┘                  └──────────────┘
   calendar +           JWT auth            authz + overlap                   meetings +
   editor UI            (Supabase)          + materialize                     meeting_series +
                                            + notifications                   meeting_participants
                                                  ▲
                        every minute, x-cron-secret│  POST /api/meetings/cron/reminders
                                            ┌──────┴────────┐
                                            │ Cloud Scheduler│  (GCP, asia-southeast1)
                                            └───────────────┘
```

- **web** — React 19 + Vite + TanStack Router/Query + Tailwind. Renders the
  calendar and the editor; talks to the backend over `/api/meetings/*`.
- **backend** — NestJS 11 on Cloud Run (`api.proyekto.tech`). Owns all business
  logic: authorization, timezone conversion, the overlap guard, recurring‑series
  materialization, scoped edits/cancels, notifications, and the reminder job. Runs
  as the Supabase **service role**, so RLS is defense‑in‑depth, not the primary gate.
- **Supabase Postgres** — the data store (see [data-model.md](./data-model.md)).
  Also the notifications backbone (`notifications` + `notification_types`).
- **Cloud Scheduler** — an external heartbeat that polls the backend to deliver due
  reminders (serverless Cloud Run has no long‑lived process). See [reminders.md](./reminders.md).

## Design principles

1. **The backend owns the clock.** The browser sends a *wall‑clock + IANA
   timezone*; the backend converts to a UTC instant. Never trust `new Date(localString)`.
   See [recurrence-and-timezones.md](./recurrence-and-timezones.md).
2. **Hybrid recurrence.** A `meeting_series` template + materialized child
   `meetings` rows — so every existing per‑row feature (list, RSVP, notifications,
   overlap guard) works on recurring instances unchanged.
3. **Authorize in the service layer.** Every repository call runs as the service
   role; authorization is enforced in `MeetingsService` against `project_access` /
   `host_id` / `created_by`. RLS mirrors it for any direct reads.
4. **Notifications are best‑effort.** A failed notification never blocks the
   scheduling action that triggered it (`notifyMany` swallows per‑recipient errors).
5. **Ship structural changes flag‑/var‑gated.** The reminder cron is gated on the
   `MEETINGS_REMINDERS_ENABLED` deploy variable.

## Component inventory

### Web (`web/src/`)

| Area | Files |
| --- | --- |
| Route | [`routes/meetings.tsx`](../../web/src/routes/meetings.tsx) — owns editor open/close state |
| Calendar shell | [`components/meetings/calendar/CalendarShell.tsx`](../../web/src/components/meetings/calendar/CalendarShell.tsx) — toolbar, view state, fetch window |
| Views | `calendar/views/{Day,Week,Month,Year}View.tsx`, `TimeGrid.tsx`, `CurrentTimeLine.tsx`, `MiniMonth.tsx`, `AgendaPanel.tsx` |
| Event render | `calendar/EventBlock.tsx` (time grid), `calendar/EventChip.tsx` (month) |
| Layout math | `calendar/overlap/layout.ts` (+ `.test.ts`) — greedy column packing |
| Range | `calendar/useCalendarRange.ts`, `calendar/model.ts` (group/filter by local day) |
| Editor | [`components/meetings/editor/MeetingEditorModal.tsx`](../../web/src/components/meetings/editor/MeetingEditorModal.tsx) + `DatePickerField`, `TimePicker`, `TimezoneSelect`, `RepeatDropdown`, `RecurrenceBuilderDialog`, `ScopeDialog`, `VideoProviderPicker`, `ProviderLogos`, `providers.ts` |
| Pure libs | [`lib/recurrence.ts`](../../web/src/lib/recurrence.ts), [`lib/datetime.ts`](../../web/src/lib/datetime.ts) (+ tests) |
| Data layer | [`services/meetings.service.ts`](../../web/src/services/meetings.service.ts), [`hooks/useMeetings.ts`](../../web/src/hooks/useMeetings.ts), `queries/meetings.ts` |
| Shared | `components/common/{AnchoredPopover,ModalPortal}.tsx` |

### Backend (`backend/src/modules/meetings/`)

| File | Responsibility |
| --- | --- |
| `meetings.controller.ts` | HTTP routes + guards |
| `meetings.service.ts` | Business logic (create, series, scoped edit/cancel, reminders, notifications) |
| `recurrence.ts` | Server RRULE expansion (floating wall‑clock → DST‑correct UTC) |
| `dto/meeting.dto.ts` | Request validation (class‑validator) |
| `repositories/meetings.repository.{interface,supabase}.ts` | Persistence |
| `meetings.module.ts` | Wiring (imports `NotificationsModule`, `AuthorizationModule`) |
| `../../common/guards/cron-secret.guard.ts` | Shared‑secret gate for the cron endpoint |

## Request lifecycles

### Create a one‑off

```
editor submit
  → wallTimeToUtcISO(date, startTime, tz)  → startISO (UTC)     [web, lib/datetime]
  → POST /api/meetings { scheduled_at: startISO, timezone, … }  [web service]
  → assert project role (if project)                            [backend authz]
  → resolve video (jitsi room / pasted link / none)
  → assertHostFree(host, start, end)  → 409 on overlap          [backend overlap guard]
  → repo.create(row) + addParticipants(host + invitees + guests)
  → notifyMany(invitees, 'meeting_invited')                     [best-effort]
  → 201 { data: Meeting }
```

### Create a recurring series

```
editor submit with recurrence body
  → POST /api/meetings { …, recurrence: 'FREQ=WEEKLY;…' }
  → createSeries: repo.createSeries(template)                   [backend]
  → materializeSeries:
       expandOccurrences(rrule, dtstartWall, tz, horizon)       [recurrence.ts, DST-correct]
       for each occurrence: insertInstanceIgnoreConflict(...)   [tolerates slot collisions]
       bulk insertParticipantRows(...)
       updateSeries({ materialized_until })
  → notifyMany(invitees, 'meeting_invited')  (once, not per instance)
  → 201 { data: firstInstance }              (has series_id)
```

### Edit / cancel a recurring occurrence (scoped)

```
web: user picks scope in ScopeDialog (this | following | all)
  → PATCH /api/meetings/:id/details { …, scope }   (edit)
     or POST /api/meetings/:id/cancel  { scope }   (cancel)
  → backend routes by scope:
       this      → update the instance in place; is_exception = true  (detach)
       all       → update the template; re-materialize future non-exception rows
       following → truncate old series (until = split); new series from the split
```

See [recurrence-and-timezones.md](./recurrence-and-timezones.md#scoped-edits--cancels)
for the exact row operations.

### Deliver reminders

```
Cloud Scheduler (every minute)
  → POST /api/meetings/cron/reminders   (x-cron-secret header)
  → CronSecretGuard checks the shared secret
  → dispatchReminders:
       findReminderCandidates(now, now+4w)      (scheduled, reminder set, not sent)
       filter to those whose lead time has passed
       claimReminders(ids)                       (atomic reminder_sent_at stamp)
       notifyMany(participants, 'meeting_reminder')  for claimed rows only
  → 200 { data: { due, notified } }
```
