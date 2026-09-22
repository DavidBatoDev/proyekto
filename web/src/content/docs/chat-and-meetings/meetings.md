Meetings is a full calendar inside the project, so the call about the work sits
next to the work rather than in a separate tool nobody in the project can see.
You get four views of the same events, a scheduler that takes timezones
seriously, and video links that are either created for you or pasted in.

## The four views

| View | Best for |
| --- | --- |
| **Day** | A single crowded day, hour by hour |
| **Week** | The default working picture |
| **Month** | Spotting the shape of a month — reviews, kickoffs, gaps |
| **Year** | Planning far out, and finding a quiet week |

The fastest way to create anything is to **click an empty slot**. The editor
opens with that date and time already filled in, so a meeting usually costs you
a title and a guest list. You can also open the editor empty and type the times
yourself.

## The editor, field by field

**Title** — what people will see in their calendar. Worth being specific: "Sync"
tells nobody anything three weeks later.

**Type** — what kind of meeting this is: kickoff, status sync, design review,
QA, scope clarification, consultation and the rest. Type is a label for finding
and reporting on meetings later; it does not change how the meeting behaves.

**Start date, start time and end time** — three separate fields rather than a
duration. Separating them is the whole point: you set when it begins and when it
ends, and you never have to work out what "90 minutes" lands on.

**Timezone** — a proper IANA timezone picker (`Europe/London`,
`Asia/Singapore`), not an offset. Pick the timezone the meeting is *in*, and
everyone else sees it converted into theirs. Offsets go wrong twice a year;
named zones do not. This matters most for a series — see [Recurring
meetings](/docs/chat-and-meetings/recurring-meetings).

**Location** — a room, an address, or anything else that tells people where to
physically be.

**Description** — the agenda, the pre-read, the links. Everything invited people
should have before they join.

**Reminder** — one offset for the meeting: five, ten, fifteen or thirty minutes
before, an hour, a day, or none.

## Video

Pick a provider in the editor and the meeting carries a joinable link:

- **A room created by Proyekto** — choose this and a video room is generated
  when the meeting is created. Nothing to set up, no account needed, and the
  link goes out with the meeting.
- **An existing link** — paste a Google Meet, Zoom or Teams URL you already
  have. Proyekto stores it and shows it on the meeting; it does not manage that
  call for you.
- **None** — for anything happening in a room, or by phone.

If the optional Google integration is switched on for your workspace *and* you
have connected your account, Proyekto can also create a Meet link for you at the
same moment. That integration may simply not be enabled — see [Google Calendar
and Meet](/docs/chat-and-meetings/google-calendar) before planning around it.

## Guests

Two kinds, and they mix freely in one meeting:

- **People in Proyekto** — pick them from the project's people. They get a
  notification and the meeting appears on their calendar in Proyekto.
- **Anyone else, by email** — type an address and it is added as an external
  guest. They do not need a Proyekto account, and inviting them grants them no
  access to the project: they are on the meeting, and that is all.

That split is the useful part. A client's finance contact can join the one call
they need to be on without you handing out project access to do it.

## Reminders

A meeting carries **one reminder offset**, and when that moment comes **every
participant is notified once**. Not once per device, not again at the start
time: once. How that notification reaches each person — in-app, push, email — is
their own setting, covered in
[Notifications](/docs/account-and-apps/notifications).

## Editing and cancelling

Open a meeting and change any field; moving it is just changing the date and
time. Everyone on the meeting is notified that it changed, so there is no need
to also message the channel — though for a big move, people appreciate the
context.

Cancelling marks the meeting cancelled rather than making it vanish. The record
stays on the calendar as cancelled, and participants are told. Keeping the
cancelled event is deliberate: "why did nothing happen on the 12th?" is a
question worth being able to answer.

If the meeting is part of a repeating series, editing and cancelling both ask
you a further question first — this occurrence, this and everything after it, or
all of them. [Recurring meetings](/docs/chat-and-meetings/recurring-meetings)
explains exactly what each choice does.
