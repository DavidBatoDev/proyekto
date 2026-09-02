# Teams & Time

> **Last updated:** 2026-09-01 · **Status:** current

Delivery runs on **teams** — reusable groups of people that attach to projects — and
**time logs** that capture billable work. The clever bit is *curation*: attaching a
team to a project and picking which members participate automatically grants them the
right project access.

## Teams

A team is owned by any user and reused across projects. Since 2026-09-01 it also has an
organizational home: `teams.workspace_id`, set on create from
`WorkspacesService.resolveWorkspaceForWrite` (an explicit `workspace_id` on `POST /api/teams`
requires membership of any role; otherwise the caller's default workspace). It is **nullable,
`ON DELETE SET NULL`, and permanently so** — a deleted workspace orphans the team rather than
destroying it. `workspace_id` is on `CreateTeamDto` only and **not** on `UpdateTeamDto`: there
is no "move team between workspaces" endpoint, because moving one would have to carry its
projects, rates, and payouts with it. Team access is still `teams.owner_id` + `team_members`;
the workspace grants nothing. See [Workspaces](../workspaces/README.md).

| Table | Holds |
| --- | --- |
| `teams` | The team (rate/time flags, default currency, freeform `tags`, and a nullable `workspace_id`) |
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

**Tags are labels, not permissions.** `teams.tags` is a freeform `text[]` (GIN-indexed,
`NOT NULL DEFAULT '{}'`) that the API normalizes on write — trimmed, whitespace-collapsed,
case-insensitively deduped, capped at 20 tags of 40 characters. They are descriptive in
exactly the sense `project_access.origin` is descriptive: nothing in authorization reads
them, and nothing may start. They are set when a team is created (the `/welcome` deck and
the `/teams` modal) and edited under Team settings → General.

**Where onboarding invites go — changed 2026-09-01.** The `/welcome` deck no longer creates a
team at all: that step was removed when the workspace step became required, and the invite step
now invites people to the **workspace** (`POST /api/workspaces/:id/invites`), not to a team and
not to the personal project. Nothing about access changed by it — a workspace seat grants no
project access either. Team membership alone still grants no project access: access appears only
once a team is attached (`project_teams`) and its members are curated in
(`project_team_members`), which is what fires the trigger above.

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

- **Backend:** [`backend/src/modules/execution/teams/`](../../../backend/src/modules/execution/teams/) (3 controllers), [`backend/src/modules/execution/team-time/`](../../../backend/src/modules/execution/team-time/)
- **Web:** `web/src/routes/_execution/teams/`, `web/src/components/team/`, `web/src/components/team-time/`

## See also

- [Product → project lifecycle](../../01-product/project-lifecycle.md) — where teams fit end to end.
- [Workspaces](../workspaces/README.md) — the container teams now live in, and why it grants nothing.
- [Finance](../finance/README.md) — what billable time becomes.
