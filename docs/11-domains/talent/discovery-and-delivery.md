# Talent Discovery and Delivery

> **Last updated:** 2026-08-18 · **Status:** current

Discovery and paid delivery use different data. The marketplace advertises a public profile;
teams and project curation establish who actually works; rates and approved time establish
what they are paid. Keeping those stages separate prevents a public profile from becoming an
authorization or payroll record.

## Marketplace card assembly

`GET /marketplace/freelancers` is active-consultant-only. It begins with profiles
that have an active freelancer enrollment, then joins related data in application code.

| Source | Card fields |
| --- | --- |
| `profiles` | Name, avatar, headline, email-verification status |
| `user_rate_settings` | Availability, hourly rate, currency |
| `user_stats` | Average rating |
| `user_specializations` | Primary specialization |
| `user_skills` + `skills` | Skill labels and slugs |

Search covers display name and headline. Filters cover availability, specialization, and
skill. Sorting supports rating descending and rate ascending or descending.

Go-live enforces verified identity, complete rate settings, portfolio evidence, and
basic profile fields on the server. The enrollment remains an opt-in availability
declaration rather than account identity; it can be paused and resumed.

## Invite boundary

Only active consultants can browse and send marketplace invites. Sending also requires
admin-or-higher project authority, rejects self-invites, and rejects profiles without
an active freelancer enrollment. Accepting grants editor access with `origin='invited'`.

## Rate boundary

| Rate | Purpose | Client-visible? |
| --- | --- | --- |
| `user_rate_settings.hourly_rate` | Marketplace expectation | Visible to browsing consultants |
| `team_member_rates.hourly_rate` | Internal team/project pay rate | No |
| `task_time_logs.rate_snapshot` | Historical cost captured when time is logged | No |
| `contracts.client_hourly_rate` | Price invoiced to the client | Yes |

The marketplace rate is not automatically the payable project rate. Team operators establish
the rate card used by time tracking and payout calculations.

## Paid-delivery invariant

```text
public profile != project access != paid curation != approved payout
```

For paid work, use a reusable or personal team, attach it to the project, curate the member,
set rates, and approve logged time. Direct project invites remain useful for reviewers and
collaborators, but they bypass the curated-member rate and activation checks.

## Privacy boundary

Internal Talent rates and member allocation percentages never appear on client invoices.
Invoices use contract pricing and may suppress or summarize time detail; member identity is
not included in invoice output.

## See also

- [Payments, payouts, and invoices](../finance/README.md)
- [Finance: contract parties](../finance/README.md#contract-parties)
- [Teams and time](../teams-and-time/README.md)
