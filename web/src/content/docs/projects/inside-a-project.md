Open a project and the sidebar splits into three groups — Project, Collaborate
and Management — with settings tucked behind a gear at the bottom. The grouping
is not cosmetic: it separates the work itself from the conversation around it
and from the records you keep about it.

## The Overview page

Overview is the landing page, and its job is to answer "how is this going?"
without anyone having to type a status.

Everything on it is **derived**. Progress comes from the roadmap: task statuses
roll up into features, features roll up into epics. Dates come from features,
which are the level that carries them. The rest comes from the registers — open
risks, change requests waiting on a decision, deliverables sitting in review.

> There is no project status field to keep up to date. Move the tasks and open
> the register entries honestly, and Overview is correct by construction.

## The Project group

**Overview** — as above.

**Roadmap** — the tree of epics, features and tasks, and the place structural
changes are made. See [How roadmaps
work](/docs/roadmaps-and-work/roadmaps-overview).

**Board** — a kanban board of this project's tasks, by status. It is per
roadmap; for everything assigned to *you* across every project, use the
[Command center](/docs/roadmaps-and-work/command-center) instead.

**Timeline** — the same data on a Gantt-style timeline, drawing features and
milestones. See [Timeline and
milestones](/docs/roadmaps-and-work/timeline-and-milestones).

**Deliverables** — what you have committed to hand over, with acceptance
criteria and named reviewers. Included on plans that carry it; see
[Deliverables](/docs/delivery-governance/deliverables).

## The Collaborate group

**Team** — everyone with access to this project and how they got it. See
[Project access and roles](/docs/projects/access-and-roles).

**Chat** — project-scoped channels, starting with `#general`, plus any channels
you add. See [Project chat](/docs/chat-and-meetings/project-chat).

### Resources

Resources is the project's library: the files and links that belong to the work
as a whole rather than to one task.

- **Upload files** — contracts, brand assets, exports, screenshots, anything the
  team should be able to find twice.
- **Add links** — for material that lives somewhere else. A link is a first-class
  entry, so a shared drive folder or a design file sits in the library next to
  the uploads instead of being buried in a chat message.
- **Search** the library by name when it grows past the point of scanning.
- **Organise** entries so the library stays navigable, rather than becoming a
  pile in upload order.

Resources is not the same as a chat attachment. An attachment belongs to the
message that carried it; a resource belongs to the project. If someone will need
it again in three months, put it here.

Who can see and upload to the library is controlled by the Resources permission
— see [Fine-tuning permissions](/docs/projects/permissions).

## The Management group

Four pages, all about keeping a record rather than doing the work:

| Page | What it holds |
| --- | --- |
| **Change Requests** | Proposed changes to scope, submitted then decided, then marked applied |
| **Decisions** | Choices made, the options considered, and which one became final |
| **Risks & Issues** | What could go wrong or has, split into internal and external |
| **Activity** | The project's audit trail, at `/logs` |

The first three are the registers, included on the plans that carry them — see
[Delivery and governance](/docs/delivery-governance/overview-governance).
Activity records what happened in the project and keeps it for as long as your
plan's retention allows; see [Activity](/docs/delivery-governance/activity).

## Behind the gear

**Time logs** — time recorded against this project's work, with its approval
state. See [Time tracking](/docs/teams-time-and-rates/time-tracking).

**Settings**, in five tabs:

- **General** — name, description and the project's basic details.
- **Permissions** — per-person page and action switches on top of each role.
- **Team** — who has access to this project, and at what role.
- **Teams** — which reusable teams are attached, and which of their members
  participate. Curating that list grants project access automatically; see
  [Teams](/docs/teams-time-and-rates/teams).
- **Time** — how time is treated here, including rates that override the
  defaults. See [Rates and currency](/docs/teams-time-and-rates/rates-and-currency).

## Why a page is missing for you

If a colleague describes a page you cannot see, it is almost always one of two
reasons, and it is worth checking them in this order:

1. **A permission is off.** Page-level visibility is set per person in
   **Settings → Permissions**. Turning one off hides that surface from the
   sidebar entirely rather than showing a locked page.
2. **Your plan does not include it.** The registers, time tracking and a few
   other surfaces belong to specific tiers. See
   [Plans](/docs/workspaces-and-plans/plans).

A project owner or admin can tell you which of the two applies in under a minute
— and the fix is different in each case.
