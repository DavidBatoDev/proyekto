# Frontend

> **Last updated:** 2026-10-07 · **Status:** current

React 19 + TanStack Router/Query + Tailwind. Everything lives under
[`web/src/components/meetings/`](../../../web/src/components/meetings/) plus the pure
libs in [`web/src/lib/`](../../../web/src/lib/) and the data layer in
`web/src/services` / `web/src/hooks`.

Built **custom on date‑fns** (no FullCalendar/react‑big‑calendar — a library's CSS
fights Tailwind v4 tokens). Token classes only (`bg-primary`, `text-primary`,
`ring-primary`) — never hardcoded hex.

## Route & top‑level state

[`web/src/routes/_execution/meetings.tsx`](../../../web/src/routes/_execution/meetings.tsx) (`/meetings`,
auth‑gated) owns just the editor open/close state and renders `CalendarShell` +
one `MeetingEditorModal`:

```tsx
const [editorOpen, setEditorOpen] = useState(false);
const [editorMeeting, setEditorMeeting] = useState<Meeting | null>(null); // null = create
const [editorStart, setEditorStart] = useState<Date>();                   // prefill from a slot

<CalendarShell currentUserId={user?.id} onCreate={openCreate} onEditMeeting={openEdit} />
<MeetingEditorModal open={editorOpen} meeting={editorMeeting} defaultStart={editorStart} … />
```

The same `MeetingEditorModal` also drops into the project **Team page**
(`components/project/team/TeamPage.tsx`) via a "Schedule meeting" button — the
editor keeps a `projectId` + `members` prop contract so it works in both places.

## Calendar

Laid out like Google Calendar (redesigned 2026‑10‑07): a toolbar across the top,
a left rail on desktop, and the active view in a rounded card. Proyekto meetings
and, when connected, the user's own Google Calendar events are merged into one
list of `CalendarItem`s and drawn together, each in its calendar's color.
Clicking any event opens a details card (`EventPopover`). There is no selected
day and no agenda panel any more.

```
+----------------------------------------------------------------------+
| (Today)  < >  October 2026   [Google]* [Connect]* (Week v) [Create]* |
+-----------------+----------------------------------------------------+
| [+ Create]      |  rounded card                                      |
|                 |                                                    |
| October 2026 < >|  Day / Week / Month / Year view                    |
| S M T W T F S   |                                                    |
|  (mini month)   |                                                    |
|                 |                                                    |
| My calendars    |                                                    |
| [x] Proyekto    |                                                    |
| [x] Google      |                                                    |
| + Connect       |                                                    |
+-----------------+----------------------------------------------------+
  left sidebar: lg+ only      * toolbar buttons: below lg only
```

### `CalendarShell.tsx`

The calendar surface. Owns `view` (`day|week|month|year`; it starts on `day`
when the window is narrower than 640px, else `week`), `anchor` (the focused
date), `opened` (the clicked item plus its bounding rect, for the popover),
per‑calendar visibility, and `now` (ticks each minute). `step(dir)` (Prev/Next)
moves `anchor` by one unit of the current view.

| Toolbar control | Behavior |
| --- | --- |
| **Today** | Rounded pill; jumps `anchor` to today |
| **‹ ›** | `aria-label` "Previous" / "Next"; step one day / week / month / year |
| Period title | `titleFor(view, anchor)`: "October 7, 2026" (day), "October 2026" (month, or a week inside one month), "Sep – Oct 2026" (a week spanning months), "Dec 2026 – Jan 2027" (spanning years), "2026" (year) |
| View picker | A native `<select>` (Day / Week / Month / Year) with a screen‑reader label "View" |
| **Google** (below `lg`) | Shown when connected; toggles Google events (eye / eye‑off; a warning icon when the Google fetch failed) |
| **Connect Google Calendar** (below `lg`) | Shown when the integration is enabled, the user is not connected, and this is not the native app |
| **Create** (below `lg`) | Opens the editor with no prefill; on `lg+` the sidebar's Create replaces it |

**Calendar visibility.** `useCalendarVisibility` keeps one flag per calendar in
`localStorage`, per browser: `meetings.showProyektoMeetings` and
`meetings.showGoogleCalendar` (`on` / `off`, visible by default). If storage is
blocked the choice lasts for the visit. Hiding Proyekto meetings drops them from
every view; hiding Google also stops the Google fetch.

**Loading and errors.** A spinner shows while meetings first load (only when
Proyekto meetings are visible); a meetings error replaces the view with "Failed
to load meetings". A Google failure never blocks the meetings: it shows only as
"Couldn't load events" in the sidebar or the warning icon on the toolbar toggle.

### Data flow

```
useCalendarRange(view, anchor) --> { from, to }
    (visible span, widened to whole months +/- 1 month)
        |                                   |
        v                                   v
useMeetingsRange(range)          useGoogleCalendarEvents(range)
  (dropped if Proyekto hidden)     (only when connected, Google visible,
        |                           and view != year)
        +-----------------+-----------------+
                          v
        toCalendarItems(meetings, googleEvents) --> CalendarItem[]
                          |
        +-----------------+------------------+
        v                                    v
  Day / Week / Month views              Year view (meetings only,
  (TimeGrid, MonthView)                 MiniMonth dots)
        |
        | click event
        v
  EventPopover --> Edit --> MeetingEditorModal (route-owned)
```

### `CalendarSidebar.tsx` (desktop, `lg+`)

| Part | Behavior |
| --- | --- |
| **Create** | Large rounded button; opens the editor with no prefill |
| Mini month | Its own month state that follows the main view's month; ‹ › page months; today in a filled circle, the anchor date tinted; clicking a date moves `anchor` there (the view stays the same) |
| **My calendars** | One `role="checkbox"` row per calendar, checked box in that calendar's color: "Proyekto meetings" always, "Google Calendar" only when connected (with the Google account email under it). A spinner while fetching; "Couldn't load events" on error |
| **Connect Google Calendar** | Link under the list when enabled but not connected (never on the native app) |

### Items and colors

[`items.ts`](../../../web/src/components/meetings/calendar/items.ts) gives every
view one shape. A `CalendarItem` has `key`, `source` (`'proyekto' | 'google'`),
`title`, `start`, an exclusive `end`, `allDay`, `free` (Google "free" time, drawn
outlined) and the original `meeting` or `googleEvent`. Meeting keys are the
meeting id; Google keys are `gcal:<id>`, so both share one overlap layout. Google
bounds come from `googleEventBounds` in
[`googleEvents.ts`](../../../web/src/components/meetings/calendar/googleEvents.ts)
(all‑day dates become local midnights with an exclusive end day; a zero‑length
all‑day event is treated as one day).

| Helper | Does |
| --- | --- |
| `toCalendarItems(meetings, googleEvents)` | Active meetings (`isActive`) plus Google events, sorted all‑day first, then by start, then longer first |
| `isBarItem` | All‑day items and items lasting 24h or more are drawn as bars, as Google does |
| `barSegments(items, days)` | Lays bar items across a row of days: one segment per item with start column, span, a stacking lane, and `clippedStart` / `clippedEnd` when it continues outside the row (long items capped at 62 days) |
| `timedItemsOnDay(items, day)` | Non‑bar items touching `day`, clipped to its minutes, so an overnight event shows on both days |
| `timedItemsStartingOn(items, day)` | Non‑bar items that start on `day` (the month view's lines) |
| `shortTime` / `timeRange` | "4pm", "8:30am"; "3 – 4pm", "11am – 1pm" (the meridiem only where it changes) |

[`calendarStyles.ts`](../../../web/src/components/meetings/calendar/calendarStyles.ts)
holds the per‑calendar colors (`dot`, `hollowDot`, `solid`, `outline`,
`checkbox`): Proyekto meetings use the theme primary (`bg-primary`); Google
Calendar uses Tailwind `sky-600`, chosen to stay distinct from every theme's
primary. That sky palette is the one deliberate exception to the token‑only rule.

[`ItemViews.tsx`](../../../web/src/components/meetings/calendar/ItemViews.tsx)
draws an item three ways:

| Component | Where | Look |
| --- | --- | --- |
| `TimedBlock` | Day / Week grid | Filled block, title over the time range ("3 – 4pm"); under 45 minutes it collapses to one line ("Title, 3pm"). A repeat icon on series meetings, a video icon when there is a link |
| `BarItem` | All‑day row, month view | 22px bar; timed multi‑day bars lead with the start time; square ends where the week clips it |
| `MonthLine` | Month view | "• 4pm Title"; a hollow dot for free events |

Free events are outlined instead of filled in every form.

### Views

| View | File | Notes |
| --- | --- | --- |
| Day / Week | `views/DayView.tsx`, `views/WeekView.tsx` | Both render `TimeGrid.tsx`. Header: weekday over a large date number (today in a filled primary circle; clicking a date opens Day view). All‑day row: bars spanning the days they cover, up to 3 lanes then "N more" (opens that day), with the timezone label (e.g. `GMT+08`, from `timeZoneOffsetLabel` with `:00` trimmed) in the gutter. Body: 24 hour rows of 48px with full‑width hour lines, `TimedBlock`s packed by the overlap layout (meetings and Google events together), a "Create meeting at ‹H›" slot button per hour, and the red `CurrentTimeLine` on today. Opens scrolled to an hour before now (7 AM when today is not shown). Header and body rows reserve the same scrollbar space (`scrollbar-gutter: stable`) so the columns line up; below `lg` the body is capped at 65vh and scrolls inside itself |
| Month | `views/MonthView.tsx` | Weekday header row, then the month's weeks (4 to 6 rows, Sunday first). Each cell centers its date (today circled, "Oct 1" on the first of a month, other months' days muted). Per week, bars span the days they cover, then timed `MonthLine`s; at most 4 lines per day, the rest collapse into "N more" (opens Day view). Clicking empty space creates a meeting at 9:00 that day ("Create meeting on ‹Month d›"); clicking the date opens Day view. At least 70vh tall below `lg` |
| Year | `views/YearView.tsx` | 12 `MiniMonth` grids with a dot on days that have active meetings; clicking a day opens Day view. Meetings only: Google events are neither fetched nor shown |

### Event details — `EventPopover.tsx`

A Google‑style card (380px, `role="dialog"`) placed beside the clicked event: to
the right when it fits, else to the left, clamped to the viewport. Below `sm` it
becomes a bottom sheet over a dimmed backdrop. Escape, the backdrop, or the X
closes it. The header shows the calendar's color swatch, the title, and when
("Wednesday, October 7 · 3 – 4pm"; all‑day and multi‑day items show date ranges).

| Item | Card contents |
| --- | --- |
| Proyekto meeting | **Join** button (`detectProvider(url) === 'google_meet'` → "Join with Google Meet", otherwise "Join video call"); "Repeats" for series; location; meeting type; guest count; description. Participants who are not the host and cannot manage it get a "Going?" row with **Yes / No / Maybe** (`accepted` / `declined` / `tentative`). The creator or host gets **Edit** (opens `MeetingEditorModal` via the route) and **Cancel** icons; cancelling a series occurrence opens `ScopeDialog` |
| Google event | **Join** (its Meet link), location, a "Google Calendar · edit it in Google Calendar" note, and an **Open in Google Calendar** icon (`htmlLink`). Proyekto never edits Google events |

### Layout math — `calendar/overlap/layout.ts`

Pure interval column‑packing: events `{start,end}` (minutes) → boxes with
`topPct / heightPct / leftPct / widthPct / columnIndex / columnCount` via greedy
packing (percentages, so the grid scales them to its own height). `TimeGrid`
feeds it `toLayout(timedItemsOnDay(...))`. Covered by `overlap/layout.test.ts`
(no‑overlap, full‑overlap, staircase, zero‑length, cross‑midnight clamp).
`calendar/model.ts` holds the meeting helpers: `isActive` (hides `cancelled` /
`rescheduled`), `durationMinutesOf`, `sameLocalDay`, `dayKey`, and `groupByDay`
(used by `MiniMonth`).

### Tests

`calendar/items.test.ts` (merging and inactive filtering, time labels, bar vs
grid, lanes, clipping at the week edge, overnight clipping, exclusive all‑day
end) and `calendar/overlap/layout.test.ts`. Run with
`cd web && npx vitest run src/components/meetings`.

### History

The 2026‑10‑07 redesign removed `AgendaPanel.tsx`, `EventBlock.tsx`,
`EventChip.tsx`, `GoogleEventBlock.tsx`, `GoogleEventDetails.tsx`, and
`googleEvents.test.ts` (replaced by `items.test.ts`, which keeps its overnight
and exclusive all‑day cases), along with the
`selectedDay` state. Before it, Prev/Next had to shift both `anchor` and
`selectedDay` so the day agenda followed the grid (`33ea5b51 fix(meetings): keep
the day agenda in sync when paging the calendar`). With no agenda, `step(dir)`
moves only `anchor`.

## Editor — `editor/MeetingEditorModal.tsx`

Modes: **create** (`meeting == null`) and **edit** (`meeting` set). One `FormState`
holds every field; `initialState` seeds it from the meeting (edit) or defaults
(create). Fields, in DOM order:

1. **Title** (`Add title`)
2. **Type** — `<select>` over `MEETING_TYPE_LABELS`
3. **Date** (`DatePickerField`) + **Start time** + **End time** (`TimePicker`) + timezone offset
4. **Timezone** (`TimezoneSelect`)
5. **Repeat** — `RepeatDropdown` (create) / a "Recurring event" badge (editing a series)
6. **Video** — `VideoProviderPicker`
7. **Guests** — member checkboxes (project context) + external‑email chips
8. **Location** (`Add location`)
9. **Reminder** — `<select>` (No reminder / 5 min / … / 1 day before)
10. **Description** (`Add description`)

Submit derives `duration_minutes = end − start`, validates (`title` present,
`end > start`, a link when `external_link`), and converts the wall‑clock to UTC via
`wallTimeToUtcISO` before POST/PATCH. **Editing a recurring occurrence** opens
`ScopeDialog` before saving.

### Sub‑components (`editor/`)

| Component | Behavior |
| --- | --- |
| `DatePickerField` | button → anchored month calendar; value `yyyy-MM-dd`. The **popover** carries `aria-label="Meeting date"`, the trigger does not (it shows the formatted date). |
| `TimePicker` | editable combobox — type a loose time (`4pm`, `16:00`) or pick a 15‑min preset; value canonical `HH:mm`. `minTime` disables end options ≤ start. |
| `TimezoneSelect` | searchable combobox over `Intl.supportedValuesOf('timeZone')`; values are IANA ids (labels keep the slash, e.g. `Australia/Sydney`). |
| `RepeatDropdown` | Google presets from `presetsFor(startDate)`; "Custom…" opens `RecurrenceBuilderDialog`. |
| `RecurrenceBuilderDialog` | interval + freq, weekday buttons (weekly), ends never/on/after, with a live `summarizeRRule` preview → emits an RRULE body. |
| `ScopeDialog` | this / following / all prompt for series edit (title "Edit recurring event") or cancel ("Delete recurring event"). |
| `VideoProviderPicker` | see below. |

### Video provider picker

Options: **Google Meet** (only when the integration is enabled — see below),
**Paste a meeting link** (`external_link`), **No video link** (`none`). When a link
is pasted, `providers.ts#detectProvider` derives the brand from the URL host and
shows `Detected: Zoom / Google Meet / Microsoft Teams / …` with an inline SVG logo
(`ProviderLogos.tsx`) — that brand is **display‑only**.

**Defaults.** A new meeting starts on `none` and is upgraded to `google_meet` once
`useGoogleCalendarStatus()` reports the organizer `enabled` *and* `connected` —
unless the organizer has already picked an option on this open (`videoTouched`).

**Legacy Jitsi meetings.** Until 2026‑10‑07 the picker offered **Generate a video
room**, which made the backend create a `meet.jit.si` room (`video_provider =
'jitsi'`). That option (and the unused `BookMeetingModal`) was removed. Editing
such a meeting seeds the form as `external_link` with its existing URL, so saving
keeps the link (the row becomes `external_link`); `detectProvider` still
recognises `jit.si` hosts so the link shows the Jitsi Meet logo and label.

The **Google Meet** option is rendered only when `useGoogleCalendarStatus()`
reports `enabled`. If the organizer isn't connected it shows an inline **Connect
Google Calendar** button (`useConnectGoogleCalendar("/meetings")` → full‑page
redirect to consent; on the native app, a "connect from a browser" note
instead); if connected it shows "Connected as {email}", and submit provisions a
real Meet link + calendar invite backend‑side. `useGoogleConnectResult()` turns
the `?google=connected|error` callback return into a toast on `/meetings` and
`/settings/integrations`.

When connected, the calendar also draws the user's own Google events
(read‑only, in the Google Calendar color, toggled from the sidebar's **My
calendars** or the small‑screen toolbar button); the connection itself is
managed in **Settings → Integrations**. Full detail in
[google-integration.md](./google-integration.md).

## Data layer

### `services/meetings.service.ts`

Typed wrappers over `/api/meetings*` (axios; envelope `{ data }`). Key types:
`Meeting`, `CreateMeetingPayload` (incl. `recurrence?`, `video_option`,
`guest_emails`, `reminder_minutes`), `UpdateMeetingPayload` (all optional +
`scope?`), `MeetingEditScope = 'this'|'following'|'all'`. Methods: `list`,
`listForProject`, `get`, `create`, `update(id,payload)`, `reschedule`,
`cancel(id, scope?)`, `respond`. A separate `googleCalendarService` exposes
`status()`, `connectUrl(returnTo)`, `disconnect()` and `events({from, to})` for
the Google integration; `isGoogleReconnectError(err)` recognises the API's
`GOOGLE_RECONNECT_REQUIRED` error.

### `hooks/useMeetings.ts`

TanStack Query hooks: `useMeetingsRange`, `useProjectMeetings`, `useMeeting`,
`useBookMeeting`, `useUpdateMeeting`, `useCancelMeeting` (accepts `string` or
`{id, scope}`), `useRescheduleMeeting`, `useRespondMeeting`, plus the Google
hooks `useGoogleCalendarStatus`, `useGoogleCalendarEvents`,
`useConnectGoogleCalendar`, `useDisconnectGoogleCalendar` and
`useGoogleConnectResult`. All meeting mutations
`invalidateQueries({ queryKey: meetingKeys.all })` so calendars + the dashboard
widget refresh.

## Shared primitives

- `components/common/ModalPortal.tsx` — portals modals to `<body>`. **Note:** the
  editor / scope / builder modals do **not** set `role="dialog"` (plain divs);
  only `AnchoredPopover` and the calendar's `EventPopover` expose
  `role="dialog"` + `aria-label`.
- `components/common/AnchoredPopover.tsx` — headless, viewport‑clamped popover used
  by the date/time/timezone/repeat pickers.
