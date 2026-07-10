# Feature Domains

> **Last updated:** 2026-07-09 · **Status:** current

One deep dive per user-facing feature domain — the companions to the
[Architecture](../02-architecture/README.md) overview and the
[Backend module list](../03-backend/modules.md). Each page covers what the feature
does, its data model, its HTTP surface, and where the code lives.

## Documentation index

| Doc | What's in it |
| --- | --- |
| [meetings/](./meetings/README.md) | Meeting scheduling — calendar, RRULE recurrence, timezones, reminders (a full sub-set) |
| [chat.md](./chat.md) | Project channels, DMs, reactions, stars, the activity feed |
| [notifications-and-push.md](./notifications-and-push.md) | In-app notifications and the FCM push fan-out |
| [payments-payouts-invoices.md](./payments-payouts-invoices.md) | The money domain — live payouts + invoices, and the retired escrow |
| [marketplace-and-applications.md](./marketplace-and-applications.md) | Consultant applications/vetting and freelancer discovery/hiring |
| [teams-and-time.md](./teams-and-time.md) | Reusable teams, project curation → access, billable time logs |
| [roadmap-sharing.md](./roadmap-sharing.md) | Tokenized read/comment sharing of a roadmap |
| [guests.md](./guests.md) | Anonymous guest sessions and the guest→user migration |

## How these relate

Most domains hang off a **project** and reuse the same spine: `project_access` for
authorization, `NotificationsModule` for alerts, and the realtime Worker for live
updates. The roadmap itself has its own sections
([Product → roadmap](../01-product/roadmap-and-milestones.md),
[Agent & Roadmap AI](../05-agent-ai/README.md)).

## Code locations

- **Backend modules:** [`backend/src/modules/`](../../backend/src/modules/) — see [Backend → modules](../03-backend/modules.md)
- **Web components:** [`web/src/components/`](../../web/src/components/)
