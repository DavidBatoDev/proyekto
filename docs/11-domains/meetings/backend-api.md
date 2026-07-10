# Backend API

NestJS module at [`backend/src/modules/meetings/`](../../../backend/src/modules/meetings/).
Controller → Service → Repository. Every repository call runs as the Supabase
**service role**; authorization is enforced in the service.

## Endpoints

Base path `/api/meetings` (global `api` prefix + `@Controller('meetings')`). All
routes are guarded by `SupabaseAuthGuard` (Bearer JWT) **except** the cron route,
which is `@Public()` + `CronSecretGuard`.

| Method & path | DTO | Purpose |
| --- | --- | --- |
| `POST /` | `CreateMeetingDto` | Create a one‑off, or a **series** if `recurrence` is set |
| `POST /cron/reminders` | — | **Scheduler‑only**; deliver due reminders (see [reminders.md](./reminders.md)) |
| `GET /` | `ListMeetingsQueryDto` | List the caller's meetings in `[from, to]` |
| `GET /project/:projectId` | `ListMeetingsQueryDto` | List a project's meetings (viewer role required) |
| `GET /:id` | — | One meeting (+ participants) |
| `PATCH /:id` | `RescheduleMeetingDto` | Reschedule a **one‑off** (retire‑and‑recreate) |
| `PATCH /:id/details` | `UpdateMeetingDto` | **General edit** (title/time/guests/… + series `scope`) |
| `POST /:id/cancel` | `CancelMeetingDto` | Cancel — with optional series `scope` |
| `POST /:id/respond` | `RespondMeetingDto` | RSVP (accept / decline / tentative) |

Responses are wrapped `{ data: … }`. List queries take `from`, `to` (ISO8601),
`status`, `project_id` — all optional; note the list returns **all** statuses
unless `status` is passed (cancelled rows are included).

## DTOs (`dto/meeting.dto.ts`)

Validated with `class-validator`. Highlights:

```ts
CreateMeetingDto {
  project_id?, title, description?, type,
  scheduled_at: ISO8601, duration_minutes? (5–1440), timezone? (≤64),
  video_option?: 'none'|'jitsi'|'external_link', meeting_url?: URL,
  participant_ids?: uuid[], guest_emails?: email[],
  location? (≤300), reminder_minutes? (0–40320),
  recurrence?: string   // RFC-5545 body → creates a series
}

UpdateMeetingDto  { …all optional…, recurrence?, scope?: 'this'|'following'|'all' }
CancelMeetingDto  { scope?: 'this'|'following'|'all' }
```

`MAX_REMINDER_MINUTES = 40320` (4 weeks). `MEETING_EDIT_SCOPES = ['this','following','all']`.

## Service (`meetings.service.ts`)

Injects the repository (`MEETINGS_REPOSITORY`), `ProjectAuthorizationService`,
`NotificationsService`, `ConfigService`.

### Create paths

- **`create(userId, dto)`** — if `dto.recurrence`, delegates to `createSeries`.
  Otherwise: authorize (project role `viewer` if `project_id`), `resolveVideo`,
  `assertHostFree` (overlap guard → `ConflictException` on collision),
  `repo.create`, add participants (host `accepted` + invitees/guests `pending`),
  `notifyMany('meeting_invited')`.
- **`createSeries(userId, dto)`** — build the template (`rrule`, `dtstart_wall` via
  `wallFromUtc`, `dtstart`, normalized `until`/`count`), `repo.createSeries`, then
  `materializeSeries`; one invite notification. Returns the **first instance**.
- **`materializeSeries(series, { inviteeIds, guestEmails, fromWall })`** — expand
  (`expandOccurrences`), clamp to `series.until`, `insertInstanceIgnoreConflict`
  per slot, bulk `insertParticipantRows`, update `materialized_until`. Returns the
  earliest created instance (or `null` if every slot collided).

### Edit / cancel

- **`updateDetails(userId, id, dto)`** — authorize (organizer/host/project‑admin).
  For a series with `scope='all'` → `updateSeriesAll`; `'following'` →
  `updateSeriesFollowing`; otherwise patch the row in place. A single occurrence of
  a series is detached (`is_exception=true`, `original_start` when time changed).
  Reconciles the attendee list (add/remove + `meeting_invited` for new invitees).
- **`updateSeriesAll` / `updateSeriesFollowing`** — see
  [recurrence-and-timezones.md](./recurrence-and-timezones.md#scoped-edits--cancels).
- **`reschedule(userId, id, dto)`** — one‑off only: create a new row linked via
  `reschedule_of`, retire the old (`status='rescheduled'`), copy participants
  (attendees reset to `pending`), notify `meeting_rescheduled`.
- **`cancel(userId, id, scope?)`** — organizer/host only. For a series + scope:
  `all` cancels template + all instances; `following` cancels from the occurrence
  and truncates `until`/`materialized_until`; else cancels the single row. Notifies
  `meeting_cancelled`.
- **`respond(userId, id, dto)`** — set the caller's participant `response`; notify
  the host `meeting_response`.

### Reminders

- **`dispatchReminders()`** — `findReminderCandidates(now, now+4w)` → filter to due
  (`scheduled_at − reminder_minutes ≤ now`) → `claimReminders(ids)` (atomic
  `reminder_sent_at` stamp) → `notifyMany('meeting_reminder')` for claimed rows
  only. Returns `{ due, notified }`. Details in [reminders.md](./reminders.md).

### Helpers

`resolveVideo` (jitsi room via `JITSI_BASE_URL` / pasted link / none),
`assertHostFree` (`findOverlappingForHost`), `uniqueInvitees` / `uniqueGuestEmails`,
`meetingContent` / `linkFor` (notification payload + deep link), `notifyMany`
(per‑recipient, **best‑effort** — swallows errors so notifications never block a
scheduling action).

## Authorization model

- **Project meetings** — the caller must have a `project_access` row (role
  `viewer`+) for create/list; **organizer (`created_by`) / host (`host_id`) /
  project admin** for edit/reschedule/cancel.
- **Personal meetings** (`project_id = NULL`) — only the organizer/host can manage.
- Enforced in the service via `ProjectAuthorizationService.assertRole` +
  explicit `created_by`/`host_id` checks. RLS mirrors this (defense‑in‑depth).

## Repository (`repositories/`)

Interface `MeetingsRepository`, Supabase impl uses the **admin (service‑role)**
client. Notable methods beyond CRUD:

| Method | Notes |
| --- | --- |
| `listForUser` / `listForProject` | OR across created/host/project/participant; `from`/`to`/`status` filters |
| `findOverlappingForHost` | double‑book guard |
| `createSeries` / `findSeriesById` / `updateSeries` | series template |
| `insertInstanceIgnoreConflict` | insert one instance, **returns null** on unique_violation (`23505`) — conflict‑tolerant materialization |
| `insertParticipantRows` | bulk participants across instances |
| `cancelSeriesInstances(seriesId, fromIso?)` | cancel scheduled instances (optionally ≥ `fromIso`) |
| `deleteFutureNonExceptionInstances` / `updateFutureNonExceptionInstances` | re‑materialization for scope=all |
| `findReminderCandidates(nowIso, maxAheadIso)` | upcoming, unsent, reminder‑set meetings (+ participants) |
| `claimReminders(ids, sentAtIso)` | atomic `UPDATE … SET reminder_sent_at WHERE reminder_sent_at IS NULL RETURNING id` — race‑safe |

Column list constant `MEETING_COLUMNS` (+ `MEETING_WITH_PARTICIPANTS` for the
joined select) lives in the Supabase impl; keep it in sync when adding columns.

## Tests

`meetings.service.spec.ts` (12) — video resolution, participant fan‑out,
double‑book guard, reschedule chaining, scoped cancel, series create/materialize,
and the 3 reminder cases. `recurrence.spec.ts` (7) — expansion incl. a DST‑crossing
weekly rule. Run a single spec: `npx jest src/modules/meetings/…` (from `backend/`).
