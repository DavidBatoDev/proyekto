Proyekto connects to your Google account in two directions. Meetings you
schedule here appear on your Google Calendar, with Google Meet links created for
you. Your own Google Calendar events show up in Proyekto's Meetings calendar, so
you can schedule around them. It is an integration, not a core part of meetings:
everything on [Meetings](/docs/chat-and-meetings/meetings) works whether or not
you connect.

## Connecting your account

Go to **Settings → Integrations** and choose **Connect Google Calendar**. You can
also connect from the Meetings toolbar, or from the meeting editor when you pick
Google Meet as the video option.

The connection is per person, not per workspace. You connect your own Google
account, and it affects your own calendar and the meetings you organise. Your
colleagues connect theirs separately, or not at all.

Connecting sends you through Google's own consent screen, where Google tells you
what Proyekto is asking for: permission to see and manage events on your
calendars. Proyekto uses it to create the events for your Proyekto meetings, keep
them up to date afterwards, and show your Google events in Meetings. You approve
it with Google, not with Proyekto, and you can review or revoke it from your
Google account at any time.

> Google may show a warning that it hasn't verified Proyekto yet. You can
> continue: choose **Advanced**, then go to Proyekto.

Once connected, Settings → Integrations shows which Google account is attached,
so you can tell a personal account from a work one at a glance.

Connecting needs a web browser. Google doesn't allow its sign-in inside apps, so
in the Proyekto mobile app, connect from proyekto.tech in a browser first. The
app picks the connection up from there.

## What syncs

Two things, both in the same direction — out of Proyekto, into Google:

- **Meetings you organise appear on your Google Calendar.** They arrive with
  their title, time, timezone and description, alongside everything else in your
  day. This is what makes a Proyekto meeting visible to the rest of your life
  without you copying it across.
- **Google Meet links can be created at the moment you schedule.** Choose Meet
  as the video provider in the editor and the room is generated with the
  meeting, and carried on the meeting record. It is one of the video options
  described in [Meetings](/docs/chat-and-meetings/meetings), alongside pasting
  a link you already have, and new meetings start on it while you are
  connected.

Later changes you make in Proyekto — a new time, a new title, a cancellation —
are reflected on the Google event.

## Your Google events in Proyekto

Once you are connected, the Meetings calendar also shows the events on your
primary Google calendar: the dentist, the flight, the meeting someone booked in
Google. They sit alongside your Proyekto meetings, drawn lighter so the two are
easy to tell apart, and they appear in the day agenda under **From Google
Calendar**.

- **They are read-only.** Open one to see its time and place, join its Google
  Meet call, or jump to it in Google Calendar to change it there.
- **They are yours alone.** Nobody else in your projects sees your Google
  events, and Proyekto doesn't store them. They are read from Google each time
  you open the calendar.
- **No duplicates.** A Proyekto meeting that is already on your Google Calendar
  shows once, as the Proyekto meeting.
- **You can hide them.** The **Google Calendar** button in the Meetings toolbar
  turns them off and on, and your choice is remembered on that device.

Only your primary Google calendar is shown, and the year view shows Proyekto
meetings only.

## What does not sync back

Changes you make in Google Calendar do not come back into Proyekto. If you drag
the event to a different hour in Google, Proyekto still holds the original time,
and that is the time everyone in the project sees.

The reason is that a Proyekto meeting is more than a calendar entry: it belongs
to a project, carries participants who may have no Google account at all, holds
its reminder offset, and its record survives in the project afterwards. Letting
an edit in one person's personal calendar silently rewrite a shared project
record would be the wrong trade.

> The Proyekto meeting is the source of truth. Google Calendar is a mirror of
> it. Make every change in Proyekto.

The same applies to guests: people you invite by email in Proyekto are
participants of the Proyekto meeting, and responses they make in their own
calendar software are not what the project reads.

## Recurring series

A series created in Proyekto maps onto a Google recurring event, so a weekly
standup arrives in Google as a weekly standup rather than as fifty separate
entries.

Occurrences you have detached — the one you moved to a different day — carry
across as exceptions to that Google recurrence, which is exactly how Google
models the same idea. The edit scopes still belong to Proyekto: choose this
occurrence, this and following, or all, in Proyekto, and the Google side
follows. See [Recurring
meetings](/docs/chat-and-meetings/recurring-meetings) for what each scope does.

## Disconnecting

You can disconnect at any time, and it is a clean operation:

- **Your Proyekto meetings are untouched.** Nothing is deleted, nothing is
  hidden, and every meeting stays exactly where it is in the project calendar.
- **Events already on your Google Calendar stay there.** Disconnecting does not
  reach back and remove them — it stops Proyekto creating and updating events
  from that point on. If you want the old ones gone from Google, remove them in
  Google.
- **Meet links already created keep working.** They are Google's rooms, and they
  are unaffected by whether Proyekto is still connected.
- **New meetings fall back to the other video options** — a link you paste,
  or none.
- **Your Google events disappear from Meetings.** Proyekto stops reading your
  calendar the moment you disconnect.

Disconnect from **Settings → Integrations**. Removing Proyekto from your Google
account's permissions has the same effect; the next time Proyekto needs your
calendar it notices, and offers to connect again.

Reconnecting later starts the mirroring again for meetings from then on; it does
not go back and recreate events for meetings scheduled while you were
disconnected.
