Proyekto can optionally connect to your Google account so that meetings you
schedule here also appear on your Google Calendar, and so that Google Meet links
can be created for you. It is an integration, not a core part of meetings —
everything on [Meetings](/docs/chat-and-meetings/meetings) works whether or not
this is switched on.

## Check whether it is available first

> This integration is optional and may not be enabled for your workspace. Check
> before you plan around it.

The honest way to find out is to open the meeting editor and look: if the Google
options are not offered, the integration is not available to you, and the
answer is not somewhere in your own settings. Ask whoever administers your
workspace. Everything below describes what happens when it *is* enabled.

## Connecting your account

The connection is per person, not per workspace. You connect your own Google
account, and it affects the meetings you organise — your colleagues connect
theirs separately, or not at all.

Connecting sends you through Google's own consent screen, where Google tells you
what Proyekto is asking for: permission to see and manage events on your
calendar, so that it can create the events for your Proyekto meetings and keep
them up to date afterwards. You approve it with Google, not with Proyekto, and
you can review or revoke it from your Google account at any time.

Once connected, Proyekto shows which Google account is attached, so you can tell
a personal account from a work one at a glance.

## What syncs

Two things, both in the same direction — out of Proyekto, into Google:

- **Meetings you organise appear on your Google Calendar.** They arrive with
  their title, time, timezone and description, alongside everything else in your
  day. This is what makes a Proyekto meeting visible to the rest of your life
  without you copying it across.
- **Google Meet links can be created at the moment you schedule.** Choose Meet
  as the video provider in the editor and the room is generated with the
  meeting, and carried on the meeting record. It is one of the video options
  described in [Meetings](/docs/chat-and-meetings/meetings), alongside a room
  Proyekto creates itself and pasting a link you already have.

Later changes you make in Proyekto — a new time, a new title, a cancellation —
are reflected on the Google event.

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
- **New meetings fall back to the other video options** — a room Proyekto
  creates, a link you paste, or none.

Reconnecting later starts the mirroring again for meetings from then on; it does
not go back and recreate events for meetings scheduled while you were
disconnected.
