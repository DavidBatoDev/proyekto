Activity is the project's audit trail: who did what, and when, across everything
in the project. The registers hold the current state of things; Activity holds
how they got there. It is the page you open when the question starts with "when
did…" or "who…".

## Where to find it

**Activity** sits in the **Management** group of the project sidebar, below the
three registers. Open it and the address bar will read `/logs` rather than
`/activity`.

> That URL is expected, not a bug. The page was named *Activity* after the route
> existed, and the old path was kept so that every link anyone had already
> bookmarked or pasted into a message still works.

## What it records

Activity is project-wide rather than per-feature, which is what makes it useful
— it is the one place the whole story is in order:

| Source | Examples |
| --- | --- |
| **Roadmap** | Commits to the roadmap's structure, and rollbacks |
| **Tasks** | Status changes, assignment, edits to work items |
| **Registers** | Deliverable submitted and reviewed, change request decided and marked applied, risk closed, decision finalised |
| **Access** | Role changes on the ladder, permission switches flipped |
| **Membership** | People added to or removed from the project |
| **Settings** | Project settings edits |

Roadmap structural changes appear here as the commits they are. For the
roadmap's own history — with the semantic diff of each commit and the ability to
roll one back — use
[Change history](/docs/roadmaps-and-work/change-history) instead. Activity tells
you a commit happened and who made it; change history tells you what was in it.

## Filtering

The log is long by design, so read it through the filters rather than by
scrolling:

- **By actor** — everything one person did. The fastest answer to "who changed
  this?"
- **By type** — narrow to access changes, register events, task changes and so
  on, when you are auditing one kind of thing rather than one period.
- **By date** — a window. Combine it with an actor or type to reconstruct a
  specific day.

Filtering by type is the underrated one. Access and membership changes on their
own are a short, readable list, and reviewing it occasionally is the cheapest
security habit available in a project.

## Retention is a window, not a deletion

How far back the log can be read is set by your plan.

> Entries age out of the retention window. Nothing you created elsewhere is
> deleted when they do: your roadmap, tasks, register entries, files and
> messages are all untouched. The **audit window itself** is what the plan
> sizes.

Older entries falling outside the window stop being viewable on this page, and a
longer window on a plan that carries one shows more history again. No plan
change removes work, and a limit in Proyekto only ever blocks something new —
see [Limits and usage](/docs/workspaces-and-plans/limits-and-usage) for how that
rule applies everywhere, and [Plans](/docs/workspaces-and-plans/plans) for what
each tier includes.

If you need a permanent record beyond the window, take it out of the log before
it ages — see exporting, below.

## Who can see it

Two separate permissions govern this page, and the difference catches people
out:

1. **Opening Activity at all.** Like every project page, it can be switched off
   per person in **Settings → Permissions**, which removes it from their sidebar
   rather than showing a locked page.
2. **Seeing entries marked sensitive.** A further permission reveals the entries
   that are flagged as sensitive. Without it, the page opens and works normally
   — those particular entries are simply not in the list.

So two people can open the same log on the same day and see different numbers of
rows, with neither of them wrong. If a colleague describes an entry you cannot
find, this is almost always the reason. Both switches live in
[Fine-tuning permissions](/docs/projects/permissions), and a project owner or
admin can tell you which one applies in a minute.

## Exporting

Exporting the activity log is an **Enterprise** capability. It is what you use
when the log has to leave Proyekto — for an external audit, a compliance
archive, or a permanent record that outlives the retention window.

On plans without export, the log is still fully readable and filterable inside
the project; there is simply no download.

## Related

- [Delivery governance](/docs/delivery-governance/overview-governance) — the
  registers whose lifecycle events land here
- [Change history](/docs/roadmaps-and-work/change-history) — roadmap commits in
  detail, with rollback
- [Limits and usage](/docs/workspaces-and-plans/limits-and-usage) — retention
  alongside the other plan allowances
