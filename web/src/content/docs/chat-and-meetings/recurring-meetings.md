A recurring meeting is one meeting plus a repeat rule, and every occurrence you
see on the calendar comes from that rule. Understanding that one sentence
explains everything else on this page — above all why editing a single
occurrence behaves differently from editing the series.

## Building the repeat rule

Turn on repeating in the meeting editor and you get a small rule builder with
four parts:

| Part | What it asks |
| --- | --- |
| **Frequency** | Repeat by day, week, month or year |
| **Interval** | Every *n* of those — every 2 weeks, every 3 months |
| **Weekdays** | For a weekly rule, which days it lands on |
| **Ends** | Never, on a date, or after a number of occurrences |

A weekly rule with Monday and Thursday selected produces two occurrences a week,
not two rules. "Every 2 weeks on Tuesday, ending after 10 occurrences" is a
single sentence in the builder and a single series afterwards.

Ending **never** is fine for a standing sync. Ending **after N occurrences** is
better for anything with a known shape — a six-week engagement produces exactly
six meetings and then stops cluttering the calendar.

## The three scopes

Every edit and every delete on a recurring meeting asks which occurrences you
mean. This is the part worth reading twice.

**This event** — changes only the occurrence you opened. The rest of the series
is untouched, and that occurrence is now an exception to the rule (see below).

**This and following events** — changes this occurrence and every future one.
Past occurrences stay exactly as they happened. Use it for a permanent change
starting on a date: the standup moves to 10:00 from next Monday onwards.

**All events** — changes the whole series, past occurrences included. Use it for
something that was always meant to be different, like a title that was wrong
from the start.

> If you are unsure, *this and following* is almost always the right answer for
> a real-world change. History is rarely improved by being rewritten.

## Detached occurrences

This is the behaviour that surprises people most, so it is worth stating
plainly:

> Editing a single occurrence splits it off from the series. From then on, later
> changes to the series leave it alone.

Move next Thursday's review to Friday, and next Thursday is now a detached
override. If you later change the whole series to 14:00, every occurrence moves
except that one — it keeps the time you gave it, because you told Proyekto that
this one is special.

That is what you want when you moved an occurrence for a reason. It is not what
you want when you have forgotten you did it, which is why a series that "will
not update" almost always has a detached occurrence in it. The fix is to edit
that occurrence directly, or to delete it and let the rule fill the gap back in.

## Timezones and daylight saving

A series carries the timezone you chose when you created it, and the rule is
evaluated in that zone. So a 09:00 Monday standup in `Europe/London` stays at
09:00 in London across the spring and autumn clock changes — the local time is
the thing being held steady.

For everyone outside that zone, the consequence is the opposite: on the weeks
either side of a clock change the meeting appears to move by an hour, because it
genuinely has, relative to them. Nothing is broken. If a series matters more to
the team in another country than to the one it was created in, create it in
*their* timezone and let the drift land on you instead.

Changing the timezone on a series is an ordinary edit, and it asks you for a
scope like any other.

## Deleting one occurrence versus ending the series

These are different operations with different consequences:

- **Delete this event** — removes one occurrence. The series continues, and the
  gap stays a gap. This is how you skip a week for a public holiday.
- **Delete this and following** — effectively ends the series from that date.
  Past occurrences remain on the calendar as the record of what happened.
- **Delete all events** — removes the entire series, history included.

If you simply want a standing meeting to stop, ending it from a date is kinder
than deleting everything: people can still see the series existed and when it
stopped.

## Reminders on a series

The reminder offset belongs to the series, and **each occurrence fires its own
reminder, notifying every participant once**. A daily standup with a ten-minute
reminder produces one notification per person per day, not a backlog.

A detached occurrence takes its reminder with it, so an occurrence you moved is
still announced at the right moment for the time it actually happens. See
[Notifications](/docs/account-and-apps/notifications) for how each person
controls where those land, and [Meetings](/docs/chat-and-meetings/meetings) for
the rest of the editor.
