Proyekto tells you something happened through three channels, and you control
each one separately. This page covers what actually generates a notification,
where it lands, and how to turn the volume down without going silent on the
things that matter.

## The three channels

| Channel | Where it appears | Notes |
| --- | --- | --- |
| **In-app** | The notifications list in Proyekto, on web and mobile | Everything lands here |
| **Push** | A banner on your phone | Only in the installed app |
| **Email** | Your inbox | Chiefly mentions and direct messages |

The in-app list is the complete set. Push and email are deliberately narrower —
they interrupt you, so they carry less.

## What generates a notification

- **Mentions** — someone `@`-mentions you in chat, or in a comment on a task,
  feature or epic.
- **Direct messages** — a new DM, including the first message from someone you
  have not spoken to before.
- **Task assignment** — you are added as an assignee. Tasks take multiple
  assignees, so each person added gets their own.
- **Register lifecycle events** — a change request submitted or decided, a
  deliverable submitted for review or reviewed, and the equivalent moments in
  risks and decisions. These are the points where someone is waiting on someone
  else. See [Governance overview](/docs/delivery-governance/overview-governance).
- **Invitations** — being invited to a project or a workspace.
- **Meeting reminders** — see below.

### Meeting reminders

A meeting carries a reminder offset — how long before the start each participant
should be told. When that moment arrives, **each participant is notified once**.
Not once per device, not again at the start: once, at the offset set on that
meeting.

For a recurring series, the offset belongs to the series, and each occurrence
fires its own reminder. Detaching a single occurrence to move it takes its
reminder with it. [Recurring meetings](/docs/chat-and-meetings/recurring-meetings)
covers the edit scopes.

## Notifications are best-effort, on purpose

This is the one thing worth knowing about how they behave:

> A notification that fails to send never blocks the action that caused it.

If the push service is unreachable or an email bounces, the task is still
assigned, the change request is still submitted, the message is still posted.
Proyekto will not roll back real work because a notification did not land. The
trade is that your inbox is a convenience, not a ledger — so when it matters
whether something happened, look at the record rather than at whether you were
told:

- The registers hold the decision, the change request, the risk, the
  deliverable and its review.
- [Activity](/docs/delivery-governance/activity) is the per-project audit trail
  at the project's **/logs** page, with retention set by your plan.

## Tuning what you receive

**Settings → Notifications** is the one place to change any of this, and it is
an account-level page: your choices apply in every workspace you belong to, not
just the one you happen to be looking at.

### Email

There is a master switch — *Send me email notifications* — and beneath it a
per-type list grouped into mentions, direct messages, invitations and
everything else. Each type is an independent toggle, so you can keep "mentioned
in a task comment" and drop "mentioned in chat" without an all-or-nothing
choice.

Types are listed as the server knows them, which means a new kind of email can
appear in the list over time. It arrives switched on and labelled; turn it off
if you do not want it.

Every notification email also carries an **unsubscribe link**. Using it is the
same as turning that type off on this page — it is a shortcut, not a separate
setting, and it does not unsubscribe you from Proyekto entirely.

### Push

Push exists **only in the installed iOS or Android app** — there is no browser
push. Turning it on happens on the device: the app asks for permission, and the
same Settings → Notifications page shows live status for that device, including
whether permission was granted, blocked or never asked for, and when the device
last registered.

That diagnostic panel is deliberately blunt rather than friendly, because a
push failure is otherwise invisible. If you are not getting push, read it
first: "Blocked" means the permission was denied at the OS level and has to be
re-granted in your phone's own settings, not in Proyekto.

See [The Proyekto mobile app](/docs/account-and-apps/mobile-app) for the rest of
what the app does and does not carry.
