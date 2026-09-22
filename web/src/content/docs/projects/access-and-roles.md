Access to a project is granted person by person. There is exactly one access
record per person per project, it carries one role, and it is the only thing
that decides whether someone can open the project at all.

## Membership is not access

This is the rule that causes the most confusion, so it is worth stating without
hedging:

> Being a member of your workspace grants a colleague nothing inside any
> project. On every plan.

A workspace member is a billable seat — they belong to your organisation, they
can be invited to things, and they show up when you go looking for someone to
add. That is all. Until a project access record exists for them, the project is
invisible to them.

The separation is deliberate. It lets an outside consultant deliver on one
project without joining your workspace, and it stops a new hire from seeing
every client's work on their first morning. See [Members and
seats](/docs/workspaces-and-plans/members-and-seats) for the other half of this.

## The ladder

Roles run from most to least: **owner → admin → editor → commenter → viewer**.
Each one can do everything the roles below it can.

| Role | Roadmap, board and timeline | Chat | Registers | Settings and access |
| --- | --- | --- | --- | --- |
| **Owner** | Full edit | Take part | Create, edit, decide | Everything, including deleting the project |
| **Admin** | Full edit | Take part | Create, edit, decide | Manage people, roles, permissions and settings |
| **Editor** | Create and edit work | Take part | Create and edit entries | No |
| **Commenter** | Read, and comment on work items | Take part | Read and comment | No |
| **Viewer** | Read | Read | Read | No |

Two caveats on that table. It describes the **baseline** a role starts from —
individual permissions can narrow any cell for a specific person, which is what
[Fine-tuning permissions](/docs/projects/permissions) covers. And pages your
plan does not include are simply not there for anyone, whatever their role; see
[Plans](/docs/workspaces-and-plans/plans).

Pick the lowest role that lets someone do their job. It is far easier to raise
someone later than to explain why they could edit something they should not
have.

## Where access came from

Every access record stores an **origin** — how that person got in:

- **Granted directly** — someone added them by hand.
- **From a team** — a team is attached to the project and they are one of the
  participating members. See [Teams](/docs/teams-time-and-rates/teams).
- **From a client or consultant relationship** — the access that comes with the
  working arrangement around the project.

Origin is descriptive. It never changes what a person can do; it exists to
explain access you did not hand out yourself. When you open the Team page and
find someone you do not remember adding, the origin column is the answer — and
usually it says a team.

## Granting access

Three routes, all from the project's **Team** page or **Settings → Team**:

1. **By email.** Use this for people outside your workspace. They get an
   invitation and, once accepted, an access record at the role you chose.
2. **By picking a workspace member.** The fast path for colleagues: choose them
   from the member list and set a role.
3. **By curating a team.** Attach a team to the project and choose which of its
   members participate. Those people get project access **automatically** — one
   action instead of five separate grants, and the natural way to onboard a
   squad.

Whichever route you use, you are choosing a role at the same time. Nobody
arrives without one.

## Changing or removing access

Changing a role takes effect immediately. Someone dropped from editor to
commenter keeps everything they wrote and simply stops being able to change the
structure.

Removing access is the more common worry, so be precise about it. When you
remove someone:

- **They lose the project.** It disappears from their sidebar, and their tasks,
  chat and files there stop being reachable.
- **The project keeps their work.** Their comments, the register entries they
  authored, the tasks they created, their chat messages and their time logs all
  stay exactly where they are, still attributed to them. Removing a person is
  not a way to remove what they contributed.

If they had access through a team, remove them from the project's participating
members or detach the team — otherwise the team grant simply puts them back.

## A share link is not project access

Sharing a roadmap creates a tokenized link, and it is a much smaller thing than
a project grant:

- It grants **viewer or commenter only** — never edit, on any plan.
- It reaches **the roadmap and nothing else**. Not chat, not Resources, not the
  registers, not the board, not time logs.
- The recipient needs no account and never appears as a project member.

That makes it the right tool for showing a client the plan and the wrong tool
for bringing anyone into delivery. See [Sharing a
roadmap](/docs/roadmaps-and-work/sharing-a-roadmap).
