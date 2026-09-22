A role is a sensible starting point, not a straitjacket. On top of it, each
person on a project can have individual permissions switched on or off — whole
pages hidden, or single actions withdrawn — without moving them up or down the
ladder.

## Where it lives

**Project Settings → Permissions**, listed per member. Pick a person and you see
their switches; change one and it applies to that person, in that project, only.
The same human can be an editor with everything on in one project and an editor
with chat hidden in another.

## How it composes

Three rules, in order:

1. The **role** sets the baseline — what an editor or a commenter can normally
   do. See [Project access and roles](/docs/projects/access-and-roles).
2. The **per-member switches** adjust that baseline.
3. Where the two disagree, **the stricter answer wins**.

> A switch is a reliable way to take something away. It is not a back door for
> handing someone more than their role allows.

The practical consequence: if you want somebody to do more, raise their role. If
you want a specific person to do less, leave the role alone and turn a switch
off. Auditing "who can do X here" then means reading one list, not reconstructing
an argument between two systems.

## The Access section: which pages exist

The first group of switches is page-level visibility. Each one gates a whole
surface:

| Switch | What it gates |
| --- | --- |
| **Roadmap** | The roadmap tree and timeline |
| **Board** | The kanban board |
| **Team** | The member list |
| **Chat** | Project channels |
| **Resources** | The file and link library |
| **Project Settings** | The gear and everything behind it |
| **Time** | Time logs for this project |
| **Delivery** | The delivery and governance surfaces |

Turning one off **hides that surface from the sidebar entirely**. The person does
not get a locked page or a permission error; the page is simply not part of the
project as far as they are concerned. That is why [Inside a
project](/docs/projects/inside-a-project) tells people missing a page to check
permissions first — an absent page looks identical to a page that does not
exist on your plan.

## The action sections: what you can do there

Below visibility sit the action switches, grouped by area. They follow the same
shape almost everywhere — **view, edit, comment** — applied to:

- **The roadmap** — viewing the tree, changing its structure, commenting on it.
- **Work items** — the equivalent trio for epics, features and tasks.
- **Chat** — reading channels versus posting in them.
- **Delivery** — reading the registers versus creating and updating entries.
- **Logs** — the project's activity trail.

Splitting view from comment from edit is what makes a useful read-only seat.
A client stakeholder who should follow the plan and leave remarks, but never
move a task, is a commenter with roadmap editing off — not a viewer who cannot
say anything and not an editor you have to trust.

## Permissions that depend on each other

Some switches only mean something in the presence of others, and Proyekto keeps
that consistent for you rather than letting you save a contradiction.

Editing the roadmap, for example, requires being able to view the roadmap, which
in turn requires the Roadmap page being visible at all. Switch roadmap editing
on for someone who had the page hidden and the prerequisites switch on with it.

So expect more switches to move than the one you clicked. Read the row after you
change it rather than assuming it did exactly one thing — particularly when you
are tightening access, where a dependency being pulled along is the difference
between what you meant and what you saved.

## Sensitive activity

The activity trail is governed by two separate permissions, and the distinction
matters:

- One opens the **Activity page** at all — whether this person can see the
  project's audit trail.
- The other reveals entries marked **sensitive** — the subset that should not be
  visible to everyone who can read the log.

Granting the first does not grant the second. Someone can follow what is
happening in the project without seeing every entry in it, which is usually the
right setting for people who are in delivery but not in governance. See
[Activity](/docs/delivery-governance/activity).

## What your plan includes

Granular per-member admin controls are an Enterprise capability. On the other
plans, the **role ladder is the main lever**: choose the role that fits and rely
on the baseline it sets, which is sufficient for most projects and considerably
harder to get wrong.

If you find yourself wanting to explain a person's access in a paragraph rather
than a word, that is the signal you have outgrown the ladder. See
[Plans](/docs/workspaces-and-plans/plans) for what each tier includes.
