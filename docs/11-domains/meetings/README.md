# Meetings & Scheduling

> **Last updated:** 2026-07-09 · **Status:** current

Native meeting scheduling for Proyekto — a Google‑Calendar‑style calendar with a
rich event editor, **recurring RRULE series**, **DST‑correct timezones**, branded
video links, guest invites, and **scheduled reminder delivery**.

This folder is the source of truth for how the feature works end to end. If you
only read one page, read [architecture.md](./architecture.md).

## What it does

- **Calendar** — Day / Week / Month / Year views with a Google‑style time grid,
  a day agenda, and click‑a‑slot‑to‑create.
- **Event editor** — title, type, separate start **date / start time / end time**,
  an **IANA timezone** picker, a **Repeat** rule builder, a branded video‑provider
  picker (Jitsi auto‑room, or paste a Meet/Zoom/Teams link), member + external‑email
  guests, location, description, and a reminder offset.
- **Recurring series** — full RRULE semantics with **edit / cancel scoped to
  _this_ / _this‑and‑following_ / _all_**, detached overrides, and cancelled‑as‑EXDATE.
- **Reminders** — a `meeting_reminder` notification to every participant, once,
  at the configured offset, delivered by an external scheduler.
- **Google Calendar / Meet** (optional, flag‑gated) — a user connects their
  Google account; choosing **Google Meet** creates a real Calendar event with a
  Meet link + attendee invites, kept in sync on edit / cancel.

## How the pieces fit (one‑liner)

> The **web** app renders the calendar and collects a wall‑clock + timezone; the
> **NestJS backend** converts it to a UTC instant, applies overlap/authorization
> rules, materializes recurring instances, and fans out notifications; **Supabase
> Postgres** stores a `meeting_series` template + child `meetings` instance rows;
> a **Cloud Scheduler** cron polls the backend to deliver due reminders.

## Documentation index

| Doc | What's in it |
| --- | --- |
| [architecture.md](./architecture.md) | Cross‑service architecture, component inventory, request lifecycles (create / edit / cancel / reminder) |
| [data-model.md](./data-model.md) | Postgres schema — tables, enums, indexes, constraints, RLS, the hybrid series model |
| [recurrence-and-timezones.md](./recurrence-and-timezones.md) | The **time‑correctness core**: wall‑clock ↔ UTC, DST, RRULE storage + expansion, materialization, horizon, scoped edit/cancel semantics |
| [frontend.md](./frontend.md) | Web calendar views, the editor, components, state model, hooks & queries |
| [backend-api.md](./backend-api.md) | HTTP endpoints, DTOs, service methods, authorization, the repository |
| [reminders.md](./reminders.md) | Reminder delivery scheduler + the guarded cron endpoint + GCP wiring |
| [google-integration.md](./google-integration.md) | Per‑user Google Calendar / Meet OAuth (Phase 5): connect flow, event sync, token storage, GCP setup |
| [operations.md](./operations.md) | Migrations, deploy, secrets, cron runbook, QA driver, troubleshooting |

## Glossary

| Term | Meaning |
| --- | --- |
| **Wall‑clock** | A calendar date + clock time with **no** offset (e.g. `2026‑07‑15T09:00`). Meaningless until paired with a timezone. |
| **Instant** | An absolute point in time, stored as UTC `timestamptz` (`scheduled_at`). |
| **Series** | A `meeting_series` template row describing a repeat rule. |
| **Instance** | A child `meetings` row materialized from a series (one per occurrence). |
| **`recurrence_id`** | The nominal (pre‑override) UTC slot of an instance — its **stable identity** within a series. |
| **Exception / detached override** | An instance edited on its own (`is_exception = true`) so a series‑wide change won't clobber it. |
| **EXDATE** | A removed occurrence — represented as a **cancelled** instance row at that slot. |
| **Horizon** | How far ahead open‑ended series are materialized (default **365 days**, capped at **200** occurrences). |
| **Scope** | Which occurrences an edit/cancel touches: `this` \| `following` \| `all`. |

## Code locations

- **Web:** [`web/src/components/meetings/`](../../../web/src/components/meetings/),
  [`web/src/routes/meetings.tsx`](../../../web/src/routes/meetings.tsx),
  [`web/src/lib/{recurrence,datetime}.ts`](../../../web/src/lib/),
  [`web/src/services/meetings.service.ts`](../../../web/src/services/meetings.service.ts),
  [`web/src/hooks/useMeetings.ts`](../../../web/src/hooks/useMeetings.ts)
- **Backend:** [`backend/src/modules/meetings/`](../../../backend/src/modules/meetings/)
  (Google OAuth / Calendar in [`meetings/google/`](../../../backend/src/modules/meetings/google/))
- **DB:** [`supabase/migrations/2026070612*`, `2026070813*`, `2026070814*`, `2026070815*`, `2026071110*`](../../../supabase/migrations/)
- **QA driver:** [`web/playwright/meetings-qa.mjs`](../../../web/playwright/meetings-qa.mjs)
