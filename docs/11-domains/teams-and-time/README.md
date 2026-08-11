# Teams & Time

> **Last updated:** 2026-08-11 · **Status:** current

Delivery runs on **teams** — reusable groups of people that attach to projects — and
**time logs** that capture billable work. The clever bit is *curation*: attaching a
team to a project and picking which members participate automatically grants them the
right project access.

## Teams

A team is owned by any user and reused across projects.

| Table | Holds |
| --- | --- |
| `teams` | The team (rate/time flags, default currency) |
| `team_members` | Roster + role (`owner` \| `admin` \| `member`) |
| `team_invites` | Email invites to join a team |
| `project_teams` | Attaches a team to a project (primary / contributor) |
| `project_team_members` | Which team members participate on a given project |
| `team_member_rates` | Per-member (and per-project) rate cards |

**Curation → access (the key mechanic):** when a member is curated into a project via
`project_team_members`, a **DB trigger** (`tg_project_team_members_sync_shares`) fans
out a `project_access` row — so their roadmap/chat access follows automatically. You
don't grant access twice. See [Data → RLS & security](../../07-data-and-db/rls-and-security.md).

Rate rules are guarded: a trigger requires a verified consultant for certain rate
operations, and the team owner can't be removed.

## Time tracking

Billable work is logged against tasks, reviewed, then rolled into payouts/invoices.

| Table | Holds |
| --- | --- |
| `task_time_logs` | A time log (start/stop or manual), member/rate/currency snapshots, paid status, optional `payout_id` |
| `time_log_comments` | Comment threads on a log |

- **Lifecycle:** start / stop / manual entry → review (per-log or bulk) → grouped into
  a payout. HTTP under `/team-time`
([Backend → api reference](../../03-backend/api-reference.md#team-time--team-time)).
- **Rate resolution** pulls from `team_member_rates` (per member, per project).
- **Durability:** deleting a project or task, or removing a member profile, severs the
  corresponding nullable FK instead of deleting the log. Running project timers are stopped
  before project deletion, and the member display-name snapshot preserves attribution.
- Approved logs feed the money domain — see
  [Finance](../finance/README.md).

## The delivery loop

```
team ──attach──► project_teams ──curate──► project_team_members ──(trigger)──► project_access
 │                                                                                  │
 └── members log time on tasks ──► task_time_logs ──review──► payouts / invoices ◄──┘
```

## Code locations

- **Backend:** [`backend/src/modules/teams/`](../../../backend/src/modules/teams/) (3 controllers), [`backend/src/modules/team-time/`](../../../backend/src/modules/team-time/)
- **Web:** `web/src/routes/teams/`, `web/src/components/team/`, `web/src/components/team-time/`

## See also

- [Product → project lifecycle](../../01-product/project-lifecycle.md) — where teams fit end to end.
- [Finance](../finance/README.md) — what billable time becomes.
