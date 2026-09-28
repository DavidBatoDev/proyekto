The decision register answers one question: *what did we settle, and why that
option?* It exists because the reasoning behind a choice evaporates far faster
than the choice itself. Six months on, everyone remembers what was decided and
nobody remembers what else was on the table — which is exactly when someone
proposes the option you already rejected.

## Creating a decision

Three parts, and the middle one is the part people skip:

**The question.** Write it as a question, not a conclusion. "Which auth provider
do we use?" ages well; "Use provider X" tells a future reader nothing about what
was being weighed.

**The options considered.** Every serious candidate, including the one you
chose, with what each would have cost you. This is the field that makes the
entry worth reading later, because a decision without its alternatives is
indistinguishable from an assumption. The obvious option that was ruled out for
a non-obvious reason is the single most valuable thing in this register.

**The rationale.** Why the chosen option won — the constraints, the trade-off
accepted, who was consulted. Record the trade-off explicitly. Every real
decision gives something up, and a rationale that reads as though the choice was
free is a rationale nobody will trust when the cost shows up.

> Write down what you rejected and why. The chosen option is the only part
> people will still remember without help.

## Categories

Each decision takes a **category**, and categories are what make the register
survive contact with time. Fifty uncategorised decisions is an archive; fifty
decisions across a handful of categories is something you can read.

Keep the set small and stable — the shape of the project rather than the shape
of one month. Architecture, scope, process, commercial, tooling: five categories
somebody will still recognise next year beat twenty precise ones nobody
maintains. The test is whether a colleague who joined last week could guess
which category a decision is in.

## Marking a decision final

A decision starts as a record and can be **marked final**. Finalising says the
question is settled and the project is proceeding on this basis — it is a
signal to the team, not a lock on the software.

The practical effect is that the entry stops being a discussion and starts being
a reference. In-flight decisions are the ones still being argued; final ones are
the ones you build on. Finalising stamps who did it and when, and the event
appears in the project's [Activity](/docs/delivery-governance/activity) log.

Finalising belongs to a project owner or admin — the same people who decide
[change requests](/docs/delivery-governance/change-requests) — because marking
something settled is an act of authority rather than of record-keeping. Anyone
with edit access can create decisions and fill in the thinking.

Do not finalise a decision that is still being discussed. A register where
everything is final and half of it is being relitigated in chat is worse than
one that is honest about what is open.

## Linking to the work

Link a decision to the [roadmap](/docs/roadmaps-and-work/roadmaps-overview) work
it affects — the epics, features or
[tasks](/docs/roadmaps-and-work/tasks) that exist, or look the way they do,
because of this choice.

The link is how a decision gets found by the person who needs it, which is
almost never the person who wrote it. Someone picking up a task months later
follows the link and sees why the approach is what it is, instead of
rediscovering a constraint the hard way — or worse, "fixing" something that was
a deliberate trade-off.

## Revisiting a final decision

Circumstances change and good decisions expire. When one does, the instinct is
to open the old entry and edit it. Do not.

> Raise a **new** decision that supersedes the old one. Do not rewrite history.

Editing a final decision destroys the only record of what was true at the time,
and it makes the register untrustworthy in a way that is hard to recover from —
once one entry has been quietly rewritten, no entry can be relied on.

The new decision should state the question again, say what changed since the
last answer, and reference the decision it replaces. The superseded entry stays
where it is. Read together, the pair tells the real story: this was right given
what we knew, that changed, here is the new answer. That sequence is far more
useful to whoever inherits the project than a single tidy entry that pretends
the first decision never happened.

Correcting a typo or adding detail that was always true is fine. Changing the
substance of a settled decision is what needs a new entry.

## Related

- [Delivery governance](/docs/delivery-governance/overview-governance) — the
  four registers and which question each answers
- [Change requests](/docs/delivery-governance/change-requests) — for variations
  to agreed scope, rather than choices
- [Activity](/docs/delivery-governance/activity) — who created and finalised
  each decision, and when
