# Data model

All schema lives in [`supabase/migrations/`](../../../supabase/migrations/). The
meetings tables were introduced/extended by:

| Migration | What it adds |
| --- | --- |
| `20260706120000_revive_meetings_scheduling.sql` | Enums, extends `meetings`, `meeting_participants`, RLS, notification types |
| `20260706120100_add_consultation_meeting_type.sql` | `'consultation'` value on the `meeting_type` enum |
| `20260708130000_meetings_location_reminder.sql` | `meetings.location`, `meetings.reminder_minutes` |
| `20260708140000_meetings_recurrence.sql` | `meeting_series` table + recurrence columns/indexes/RLS on `meetings` |
| `20260708150000_meetings_reminder_delivery.sql` | `meetings.reminder_sent_at` + partial index |

> **Authorization note:** every backend repository call runs as the Supabase
> **service role** and bypasses RLS. Primary authz is in the NestJS service layer
> (against `project_access` / `host_id` / `created_by`). The RLS policies below are
> defense‑in‑depth for any direct‑from‑web or realtime reads.

## Entity relationships

```
projects ──┐
           │ (nullable)
 profiles ─┼─ meeting_series 1 ─── N meetings ─── N meeting_participants
   host_id │        (series_id, ON DELETE CASCADE)      (meeting_id, CASCADE)
 created_by┘                                     user_id → profiles (nullable = guest)
```

- A **standalone** meeting has `series_id = NULL`.
- A **recurring instance** has `series_id` set and a `recurrence_id` (its nominal slot).
- `project_id` and `created_by` are **nullable** — profile‑level and guest bookings
  have no project / no authenticated creator; `host_id` + `guest_*` carry the actor.

## Enums

```sql
meeting_status         : scheduled | cancelled | completed | rescheduled | no_show
meeting_video_provider : none | external_link | jitsi | google_meet
meeting_response       : pending | accepted | declined | tentative
meeting_type           : kickoff | status_sync | design_review | qa |
                         scope_clarification | retainer_sync | client_consultant |
                         consultant_freelancer | consultation
```

`google_meet` is reserved for the future OAuth phase; the branded picker stores
`external_link` and derives the brand from the URL host (display‑only — see
[frontend.md](./frontend.md#video-provider-picker)).

## `meetings`

The instance / one‑off table. Key columns:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `project_id` | uuid → projects, **nullable** | CASCADE |
| `host_id`, `created_by` | uuid → profiles, nullable | actor |
| `title`, `description`, `type` | | `type` is `meeting_type` |
| `scheduled_at` | timestamptz | **UTC instant** of the start |
| `ends_at`, `duration_minutes` | | end derived from start + duration |
| `status` | `meeting_status` | default `scheduled` |
| `video_provider` | `meeting_video_provider` | default `none` |
| `meeting_url`, `timezone`, `location` | | `timezone` = IANA zone the wall‑clock was entered in |
| `reminder_minutes` | int, nullable | minutes‑before offset |
| `reminder_sent_at` | timestamptz, nullable | reminder idempotency marker (Phase 4) |
| `guest_email`, `guest_name`, `guest_session_id` | | guest bookings |
| `reschedule_of` | uuid → meetings | retire‑and‑recreate chain for one‑off reschedules |
| `google_event_id` | text | reserved (Phase 5) |
| **`series_id`** | uuid → meeting_series, CASCADE | null = standalone |
| **`recurrence_id`** | timestamptz | nominal UTC slot — stable identity in a series |
| **`original_start`** | timestamptz | original nominal start if a single occurrence was moved |
| **`is_exception`** | bool, default false | true = detached override |
| `created_at`, `updated_at` | | `updated_at` via `handle_meetings_updated_at()` trigger |

### Indexes & constraints on `meetings`

```sql
idx_meetings_project_id, idx_meetings_host_id, idx_meetings_scheduled_at,
idx_meetings_status, idx_meetings_series_id

-- Double-booking backstop: ≤1 scheduled meeting per host per exact start.
uq_meetings_host_slot     UNIQUE (host_id, scheduled_at) WHERE status='scheduled' AND host_id IS NOT NULL

-- Idempotent materialization: ≤1 instance per series slot.
uq_meetings_series_slot   UNIQUE (series_id, recurrence_id) WHERE series_id IS NOT NULL

-- Reminder scan (Phase 4).
idx_meetings_reminder_due (scheduled_at) WHERE status='scheduled'
                            AND reminder_minutes IS NOT NULL AND reminder_sent_at IS NULL
```

> ⚠️ **`uq_meetings_host_slot` interacts with series.** Two meetings for the same
> host at the *exact* same UTC instant collide. Materialization tolerates this
> per‑slot (see `insertInstanceIgnoreConflict` in [backend-api.md](./backend-api.md)),
> skipping the colliding occurrence instead of failing the whole series.

## `meeting_series` (recurrence template)

One row per repeating meeting. The rule pattern + a start; instances are
materialized from it.

| Column | Notes |
| --- | --- |
| `id` uuid PK | |
| `project_id`, `created_by`, `host_id` | mirror `meetings` |
| `title`, `description`, `type`, `duration_minutes`, `timezone`, `video_provider`, `meeting_url`, `location`, `reminder_minutes` | the per‑instance template values |
| **`rrule`** text | RFC‑5545 body **without** `RRULE:` and **without** `DTSTART` (e.g. `FREQ=WEEKLY;INTERVAL=1;BYDAY=TU`) |
| **`dtstart_wall`** text | naive wall‑clock start `YYYY-MM-DDTHH:MM:SS`, evaluated in `timezone` |
| **`dtstart`** timestamptz | UTC instant of the first occurrence |
| `until`, `count` | normalized mirrors of the rule's end (informational) |
| `status` text | `active` \| `cancelled` |
| **`materialized_until`** timestamptz | horizon watermark — occurrences up to here exist as rows |
| `created_at`, `updated_at` | trigger‑maintained |

Indexes: `idx_meeting_series_project`, `idx_meeting_series_host`.

Why store `dtstart_wall` **and** `dtstart`? The rule is expanded in *floating*
(wall‑clock) space so DST doesn't drift the local time, then each occurrence is
converted to UTC in `timezone`. See
[recurrence-and-timezones.md](./recurrence-and-timezones.md).

## `meeting_participants`

Per‑attendee RSVP + notification fan‑out.

| Column | Notes |
| --- | --- |
| `id` uuid PK | |
| `meeting_id` uuid → meetings, CASCADE | |
| `user_id` uuid → profiles, nullable | **null = external guest** (see `guest_email`) |
| `guest_email`, `guest_name` | for `user_id IS NULL` rows |
| `role` text | `host` \| `attendee` |
| `response` | `meeting_response`, default `pending` (host rows are `accepted`) |

- `uq_meeting_participants_user UNIQUE (meeting_id, user_id) WHERE user_id IS NOT NULL`
  — one row per user per meeting.
- The host is always added as a participant (`role='host'`, `response='accepted'`).

## The hybrid recurrence model (CalDAV‑style)

Instead of a separate exceptions table, the instance rows themselves encode the
overrides:

| Situation | Representation |
| --- | --- |
| Normal occurrence | instance row, `is_exception=false`, `status='scheduled'` |
| **Removed** occurrence (EXDATE) | instance row, `status='cancelled'` at that `recurrence_id` |
| **Modified** occurrence (detached override) | instance row, `is_exception=true`, divergent fields |
| Series ended early | template `until` truncated; future non‑exception rows deleted/cancelled |

Expansion skips any nominal slot that already has a row (join on `recurrence_id`),
so re‑materialization is idempotent and never clobbers a detached override.

## Row‑Level Security (summary)

Both `meetings` and `meeting_series` enable RLS with parallel policies:

- **SELECT** — you created it, you're the host, you belong to its project
  (`project_access`), or (meetings only) you're a listed participant.
- **INSERT** — `auth.uid() = created_by` and (no project, or you belong to it).
- **UPDATE** — creator or host.
- **DELETE** — creator, host, or the project's consultant.
- `meeting_participants` — readable if you're the row or can see the parent
  meeting; you may UPDATE only **your own** RSVP.

Full policy SQL: [`20260706120000_revive_meetings_scheduling.sql`](../../../supabase/migrations/20260706120000_revive_meetings_scheduling.sql)
and [`20260708140000_meetings_recurrence.sql`](../../../supabase/migrations/20260708140000_meetings_recurrence.sql).

## Notification types

Seeded in the revive migration (`ON CONFLICT DO NOTHING`):

```
meeting_invited (high) · meeting_response (medium) · meeting_cancelled (high) ·
meeting_rescheduled (high) · meeting_reminder (medium)
```

Notifications are written to `notifications` with a `type_id` FK into
`notification_types`; delivery also fires a best‑effort FCM push.
