Structural changes to a roadmap are recorded as commits. Each one has an author,
a time and a diff of exactly what moved, and each one can be inspected before it
lands or rolled back after. This is what makes restructuring a roadmap a
low-stakes act rather than something you put off until Friday.

## What counts as a change

History records **structural** edits to the roadmap tree:

- **Adding** an epic, feature or task
- **Removing** one
- **Moving** a node to a new parent, or reordering siblings
- **Renaming** a node
- **Re-dating** a feature

It is not a keystroke log. Typing into a description does not produce five
entries, and a comment on a task is not a structural change to the roadmap. What
gets recorded is what would change the answer to "what is the plan?".

## The three verbs

| Verb | When | What it does |
| --- | --- | --- |
| **Commit** | A change is staged and not yet applied | Lands it on the roadmap for everyone |
| **Discard** | Before it lands | Throws the staged change away; the roadmap never saw it |
| **Roll back** | After it landed | Records a new change that undoes the old one |

The distinction between discard and roll back is worth holding onto. Discarding
is cheap — nothing happened, so nothing needs undoing. Rolling back is a real
edit: the roadmap did change, other people may have seen it, and the reversal is
itself an entry in the history with your name on it. Nothing is erased from the
record.

Staging mostly shows up in two places: a batch of edits you are assembling, and
anything the AI assistant proposes, which is always
[two-stage](/docs/ai-assistant/reviewing-changes) — preview the diff, then
commit.

## Reading an entry

Open a change and you see:

- **Who** made it — a person, or the assistant acting on someone's instruction.
- **When** it landed.
- **The semantic diff**: which nodes were added, removed, moved, renamed or
  re-dated, described in terms of epics, features and tasks rather than as a
  text patch.

"Semantic" is the useful part. The entry says *"Feature 'Checkout redesign'
moved from epic 'Payments' to epic 'Storefront'"*, not a wall of changed fields.
You can read a month of history and understand what happened to the plan.

## Rolling back an assistant change

There is **no separate AI undo**, and that is deliberate.

> A change the assistant made is rolled back by exactly the same operation as a
> change a colleague made. Same list, same diff, same button.

The assistant does not have a privileged write path into your roadmap — it
proposes operations, a person commits them, and the commit is recorded like any
other. Once you know how to roll back a human's restructure, you know how to
roll back the assistant's, which is one fewer thing to learn at the exact moment
you are least in the mood to learn it.

## What rollback does not touch

A rollback restores **structure**. It does not reach into everything attached to
the work:

- **Comments** stay where they are.
- **Attachments** stay attached.
- **Register entries** — deliverables, change requests, risks and decisions —
  and the links between them and the affected work are not rewound.

So if a feature was deleted and you roll that back, the feature returns; a
conversation that happened in the meantime is still there, and a decision
someone recorded while it was gone is still recorded. History is not a time
machine for the whole project, and treating it as one is the main way people
surprise themselves.

After any rollback that mattered, check the register entries that pointed at the
affected work and make sure they still say something true.

## History versus project Activity

Two different logs, two different scopes.

| | Roadmap change history | [Project Activity](/docs/delivery-governance/activity) |
| --- | --- | --- |
| **Covers** | Roadmap structure only | Everything else in the project — access changes, register lifecycle events, and more |
| **Lives at** | The roadmap | The project's `/logs` page |
| **You can** | Inspect, discard, roll back | Read and filter; retention is set by your plan |

If the question is *"why does the plan look different?"*, you want change
history. If it is *"who was given access last Tuesday?"* or *"when was that
change request decided?"*, you want Activity.

Activity retention is one of the counted plan limits, and exporting it is part
of the top tier — see [Plans](/docs/workspaces-and-plans/plans). Reaching a
retention limit never affects your roadmap history, which is part of the
roadmap itself.

## Related

- [Building a roadmap](/docs/roadmaps-and-work/building-a-roadmap) — the edits
  this page records
- [Reviewing what the assistant changed](/docs/ai-assistant/reviewing-changes) —
  the preview-then-commit flow in detail
