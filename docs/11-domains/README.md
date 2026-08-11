# Feature Domains

> **Last updated:** 2026-08-10 · **Status:** current

One deep dive per user-facing feature domain — the companions to the
[Architecture](../02-architecture/README.md) overview and the
[Backend module list](../03-backend/modules.md). Each page covers what the feature
does, its data model, its HTTP surface, and where the code lives.

## Participant positions

There is no stored account role — client, talent, and consultant are **market
positions** (per contract), and the only account-level capability is consultant
vetting. See [Product → roles and capabilities](../01-product/personas.md).

| Doc | What's in it |
| --- | --- |
| [clients/](./clients/README.md) | The client position — structure, permission resolution, user flows, surfaces, and the consultant handoff (a full sub-set) |
| [talent/](./talent/README.md) | The Talent position — discovery, project access, delivery, time, and payout boundaries (a full sub-set) |
| [consultants/](./consultants/README.md) | The Consultant position — vetting, active capabilities, project operation, and consultant-only surfaces (a full sub-set) |

## Delivery lifecycle

| Doc | What's in it |
| --- | --- |
| [marketplace/](./marketplace/README.md) | Consultant applications, vetting, Talent discovery, and hiring |
| [teams-and-time/](./teams-and-time/README.md) | Reusable teams, project curation → access, rates, and billable time |
| [finance/](./finance/README.md) | Payouts, invoices, contract pricing boundaries, and the retired escrow |

## Collaboration

| Doc | What's in it |
| --- | --- |
| [chat/](./chat/README.md) | Project channels, DMs, reactions, stars, and the activity feed |
| [meetings/](./meetings/README.md) | Meeting scheduling — calendar, recurrence, timezones, and reminders (a full sub-set) |
| [notifications/](./notifications/README.md) | In-app notifications, FCM push fan-out, deferred mention email, and notification preferences |

## Platform experiences

| Doc | What's in it |
| --- | --- |
| [roadmap-sharing/](./roadmap-sharing/README.md) | Tokenized read/comment sharing of a roadmap |
| [guests/](./guests/README.md) | Anonymous guest sessions and guest-to-user migration |

## How these relate

Most domains hang off a **project** and reuse the same spine: `project_access` for
authorization, `NotificationsModule` for alerts, and the realtime Worker for live
updates. The roadmap itself has its own sections
([Product → roadmap](../01-product/roadmap-and-milestones.md),
[Agent & Roadmap AI](../05-agent-ai/README.md)).

## Code locations

- **Backend modules:** [`backend/src/modules/`](../../backend/src/modules/) — see [Backend → modules](../03-backend/modules.md)
- **Web components:** [`web/src/components/`](../../web/src/components/)
