# Recurrence & timezones

This is the correctness core of the feature. Two rules govern everything:

1. **A meeting's stored `scheduled_at` is a UTC instant**, computed from a
   *wall‑clock + IANA timezone* — never from the browser's local zone.
2. **Recurring rules are expanded in floating (wall‑clock) space**, then each
   occurrence is converted to UTC in the series timezone — so a "9 am weekly"
   meeting stays at 9 am **local** across a DST change even though its UTC offset
   shifts.

Both are covered by unit tests: `web/src/lib/{recurrence,datetime}.test.ts` and
`backend/src/modules/meetings/recurrence.spec.ts` (incl. a DST‑crossing case),
and end‑to‑end by the QA driver (see [operations.md](./operations.md#qa-driver)).

---

## 1. Timezone correctness (all meetings)

### The trap

```ts
new Date("2026-07-15T09:00")   // ← interprets the wall-clock in the BROWSER's zone
```

This is silently wrong the moment the user picks a timezone other than their own.
The old booking modal did exactly this.

### The fix

The editor collects three things — a **date**, a **start/end time**, and an
**IANA timezone** — and converts via `date-fns-tz`:

```ts
// web/src/lib/datetime.ts
export function wallTimeToUtcISO(date, time, timeZone) {
  const naive = `${date}T${time}:00`;             // e.g. "2026-07-15T09:00:00"
  return fromZonedTime(naive, timeZone).toISOString();
}
```

`fromZonedTime("2026-07-15T09:00:00", "Australia/Sydney")` → `2026-07-14T23:00:00Z`
(Sydney is UTC+10 in July). The backend stores that instant plus the `timezone`
string, so the wall‑clock can be reconstructed later (`utcToZonedParts`).

The **backend never re‑interprets** the wall‑clock; it trusts the `scheduled_at`
the client computed, and for series it recomputes each occurrence from
`dtstart_wall` + `timezone` itself (below).

### Why store the timezone at all?

- To re‑open the editor showing the same wall‑clock the organizer entered.
- To expand recurring occurrences DST‑correctly per‑occurrence.
- The calendar grid itself renders in the **viewer's local zone**
  (`web/.../calendar/model.ts` groups by local day) — projecting the whole grid
  into an arbitrary display zone is a future enhancement; the stored instant is
  always canonical.

---

## 2. RRULE storage

We store the **body** of an RFC‑5545 rule — no `RRULE:` prefix, no `DTSTART`
line — because the start (wall‑clock + timezone) is persisted separately:

```
FREQ=WEEKLY;INTERVAL=1;BYDAY=WE        ← meeting_series.rrule
2026-07-15T09:00:00                    ← meeting_series.dtstart_wall  (naive)
America/New_York                       ← meeting_series.timezone
```

Weekday integers follow **rrule's convention: `0=Mon … 6=Sun`** (note: *not* JS's
`0=Sun`). Conversion helper: `rruleWeekdayOf(date)` in
[`web/src/lib/recurrence.ts`](../../web/src/lib/recurrence.ts).

### Client rule helpers (`web/src/lib/recurrence.ts`)

Pure wrappers over the `rrule` library, shared by the editor and calendar:

| Function | Purpose |
| --- | --- |
| `buildRRule(rule)` | structured `RecurrenceRule` → RFC‑5545 body |
| `parseRRule(body)` | body → structured (for re‑opening the editor) |
| `summarizeRRule(body, dtstart)` | `rrule.toText()` → "Every week on Wednesday" |
| `presetsFor(startDate)` | the Repeat dropdown presets (Daily / Weekly on ‹day› / Monthly on day N / Annually / Every weekday / Custom…) |
| `rruleToPresetId(body, startDate)` | which preset a stored rule matches (non‑1 interval or an end ⇒ `custom`) |

The structured shape:

```ts
interface RecurrenceRule {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;              // ≥ 1
  byweekday?: number[];          // 0=Mon … 6=Sun (weekly)
  bymonthday?: number[];         // 1–31 (monthly/yearly)
  bymonth?: number[];            // 1–12 (yearly)
  ends: { type: "never" }
      | { type: "on"; date: string }      // yyyy-MM-dd, inclusive, UTC end-of-day
      | { type: "after"; count: number };
}
```

---

## 3. DST‑correct expansion (server)

[`backend/src/modules/meetings/recurrence.ts`](../../backend/src/modules/meetings/recurrence.ts)
is the authoritative expander. The trick is **floating expansion + per‑occurrence
UTC conversion**:

```
dtstart_wall "2026-07-15T09:00:00"
   │  floatingFromWall()  → a Date whose UTC fields equal the wall-clock
   ▼
RRule.between(start, dtstart + horizon)      ← rrule runs in floating space,
   │                                            so every occurrence is 09:00 "wall"
   ▼  for each floating occurrence f:
fromZonedTime(wallString(f), timezone).toISOString()   ← real UTC instant
   ▼
{ recurrenceId: utc, scheduledAt: utc }
```

Because rrule never sees a real offset, it can't drift the local time across a DST
boundary. The conversion to UTC happens *after*, per occurrence, in the series
zone. Result for a 9 am `America/New_York` weekly meeting:

| Occurrence | Local (NY) | UTC | Offset |
| --- | --- | --- | --- |
| Jul 15 2026 | 09:00 | `13:00Z` | EDT (‑4) |
| Nov 4 2026 | 09:00 | `14:00Z` | EST (‑5) |

Same wall‑clock, different UTC — exactly right. (The QA driver asserts both the
`13:00Z`/`14:00Z` split and that every instance formats to `09:00` in NY.)

### Horizon & caps

```
DEFAULT_HORIZON_DAYS = 365        // materialize ~1 year ahead
MAX_OCCURRENCES      = 200        // hard cap per expansion
```

- **Bounded rules** (`COUNT` / `UNTIL`) fully materialize (up to the cap).
- **Open‑ended rules** materialize to the horizon; a top‑up job is expected to
  extend them (the `materialized_until` watermark exists for it — **the top‑up
  cron is not yet wired**, see [operations.md](./operations.md#not-yet-wired)).

`expandOccurrences(body, dtstartWall, timezone, { fromWall, horizonDays, max })`
accepts a `fromWall` so a top‑up only expands occurrences at/after the watermark.

---

## 4. Materialization

`MeetingsService.materializeSeries` (see [backend-api.md](./backend-api.md)) turns
occurrences into rows:

```
for each occurrence:
  insertInstanceIgnoreConflict({ series_id, recurrence_id, scheduled_at, ends_at, … })
     └─ tolerates a Postgres unique_violation (23505) on
        uq_meetings_series_slot / uq_meetings_host_slot → returns null, skip the slot
  collect participant rows (host + invitees + guests)
bulk insertParticipantRows(...)
updateSeries({ materialized_until: lastOccurrence })
```

- **Conflict‑tolerant** — an exact host+time collision (across two series, or a
  series + one‑off) skips that single slot instead of failing the create.
- **Idempotent** — re‑running against `uq_meetings_series_slot` never duplicates.
- **One notification per invitee**, not per instance (avoids reminder spam on create).

---

## 5. Scoped edits & cancels

Google‑Calendar semantics: an edit/cancel of a recurring occurrence asks **which
occurrences** it applies to. The UI is `ScopeDialog` (this / following / all);
the backend routes each scope to row operations.

### Edit (`PATCH /api/meetings/:id/details` with `scope`)

| Scope | Row operations |
| --- | --- |
| **this** | Update the instance **in place** and set `is_exception = true`, so a later series‑wide change won't clobber it. If the time moved, stamp `original_start = recurrence_id`. Never routed through the reschedule retire‑and‑recreate path (that would orphan it from the series). |
| **all** | `updateSeriesAll` — update the `meeting_series` template, then re‑materialize **future non‑exception** instances (detached overrides are preserved; past instances are left). |
| **following** | `updateSeriesFollowing` — truncate the old series (`until` = the split), delete future non‑exception rows ≥ the split, then create a **new** `meeting_series` (edited template, `dtstart` = the selected occurrence) and materialize it. (CalDAV `THISANDFUTURE`.) |

### Cancel (`POST /api/meetings/:id/cancel` with `scope`)

| Scope | Row operations |
| --- | --- |
| **this** | Cancel just that instance (`status='cancelled'`) — it doubles as an EXDATE. |
| **all** | Set the series `status='cancelled'` **and** bulk‑cancel every scheduled instance. |
| **following** | Cancel this occurrence onward (`cancelSeriesInstances(seriesId, fromIso)`) and truncate the series (`until` = the occurrence, `materialized_until` = the occurrence) so it won't re‑materialize past the split. |

One notification per scope (not per affected instance).

> **"Edit all" can overwrite a detached override** only for instances that are
> **not** exceptions — detached overrides (`is_exception=true`) are preserved by
> design. This is the one documented data‑loss surprise to be aware of.

### Standalone reschedule vs. series edit

A **standalone one‑off** reschedule uses the retire‑and‑recreate chain
(`reschedule_of`): a new row is created and the old one is set to `rescheduled`.
**Series‑instance** time edits use the in‑place update keyed by `recurrence_id`
above. These two paths never mix.
