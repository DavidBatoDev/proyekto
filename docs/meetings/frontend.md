# Frontend

React 19 + TanStack Router/Query + Tailwind. Everything lives under
[`web/src/components/meetings/`](../../web/src/components/meetings/) plus the pure
libs in [`web/src/lib/`](../../web/src/lib/) and the data layer in
`web/src/services` / `web/src/hooks`.

Built **custom on date‑fns** (no FullCalendar/react‑big‑calendar — a library's CSS
fights Tailwind v4 tokens). Token classes only (`bg-primary`, `text-primary`,
`ring-primary`) — never hardcoded hex.

## Route & top‑level state

[`web/src/routes/meetings.tsx`](../../web/src/routes/meetings.tsx) (`/meetings`,
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

### `CalendarShell.tsx`

The calendar surface. Owns `view` (`day|week|month|year`), `anchor` (the focused
date), `selectedDay` (drives the agenda), and `now` (ticks each minute). Renders a
Google‑style toolbar (Today · ‹ › · title · view toggle · timezone label · Create)
and fetches its own window via `useCalendarRange(view, anchor)` → `useMeetingsRange`.

> **Navigation ↔ agenda sync:** `step(dir)` (Prev/Next) shifts **both** `anchor`
> and `selectedDay` by the same unit, so the day agenda follows the grid you page
> to. (This was a bug — see `fix(meetings): keep the day agenda in sync`.)

### Views

| View | File | Notes |
| --- | --- | --- |
| Day / Week | `views/DayView.tsx`, `views/WeekView.tsx` | share `TimeGrid.tsx` — 24 hour rows, absolutely‑positioned `EventBlock`s, a red `CurrentTimeLine` on today, and per‑hour "Create meeting at ‹H›" slot buttons |
| Month | `views/MonthView.tsx` | 6‑week grid; each day cell shows ≤2 `EventChip`s + "+N more"; click a **day** selects it (agenda), click a **chip** opens the meeting |
| Year | `views/YearView.tsx` | 12 `MiniMonth` grids with event dots; click a day → jumps to Day view |
| Agenda | `AgendaPanel.tsx` | the selected day's meetings with Join / Accept / Decline / Edit / Cancel; recurring rows show a ⟳ badge and route Cancel through `ScopeDialog` |

### Layout math — `calendar/overlap/layout.ts`

Pure interval column‑packing: events `{start,end}` (minutes) → boxes with
`leftPct / widthPct / topPx / heightPx / columnIndex / columnCount` via greedy
packing. Covered by `overlap/layout.test.ts` (no‑overlap, full‑overlap, staircase,
zero‑length, cross‑midnight clamp). `calendar/model.ts` groups/filters meetings by
**local** day and hides `cancelled` / `rescheduled` (`isActive`).

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

Three options: **Generate a video room** (jitsi, auto), **Paste a meeting link**
(`external_link`), **No video link** (`none`). When a link is pasted,
`providers.ts#detectProvider` derives the brand from the URL host and shows
`Detected: Zoom / Google Meet / Microsoft Teams / …` with an inline SVG logo
(`ProviderLogos.tsx`). The brand is **display‑only** — the backend stores only
`jitsi | external_link | none` + the URL.

## Data layer

### `services/meetings.service.ts`

Typed wrappers over `/api/meetings*` (axios; envelope `{ data }`). Key types:
`Meeting`, `CreateMeetingPayload` (incl. `recurrence?`, `video_option`,
`guest_emails`, `reminder_minutes`), `UpdateMeetingPayload` (all optional +
`scope?`), `MeetingEditScope = 'this'|'following'|'all'`. Methods: `list`,
`listForProject`, `get`, `create`, `update(id,payload)`, `reschedule`,
`cancel(id, scope?)`, `respond`.

### `hooks/useMeetings.ts`

TanStack Query hooks: `useMeetingsRange`, `useProjectMeetings`, `useMeeting`,
`useBookMeeting`, `useUpdateMeeting`, `useCancelMeeting` (accepts `string` or
`{id, scope}`), `useRescheduleMeeting`, `useRespondMeeting`. All mutations
`invalidateQueries({ queryKey: meetingKeys.all })` so calendars + the dashboard
widget refresh.

## Shared primitives

- `components/common/ModalPortal.tsx` — portals modals to `<body>`. **Note:** the
  editor / scope / builder modals do **not** set `role="dialog"` (plain divs);
  only `AnchoredPopover` exposes `role="dialog"` + `aria-label`.
- `components/common/AnchoredPopover.tsx` — headless, viewport‑clamped popover used
  by the date/time/timezone/repeat pickers.
