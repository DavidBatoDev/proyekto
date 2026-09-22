A roadmap tells you what the plan is. It does not tell you why the date moved,
who objected, or what was agreed in the call. That reasoning lives in chat, in
comments and in the brief — and the project knowledge base is an optional index
over exactly that material, so the assistant can answer from what your team
actually said.

## It may not be enabled

The knowledge base ships behind a switch. It is not guaranteed to be on for
your workspace or your project, and there is no setting on the article page
that turns it on for you.

The way to tell is to ask a question that only discussion could answer — "what
did we decide about the payment provider?" — and look at the reply. With the
index on, the answer comes back citing the message, comment or activity entry
it came from. With it off, the assistant answers from the roadmap alone, and
will say that it does not have that information rather than making something
up.

> The assistant never pretends the index is there. No citation means no
> retrieval, not a confident guess.

## What gets indexed

When the knowledge base is enabled for a project, it draws on the written
record of that project:

- **Chat messages** in the project's channels
- **Comments** on epics, features and tasks
- **Project activity** — the audit trail of what changed and when
- **The brief**, where the project started from one

The index is per project. Content from one project is never mixed into answers
about another.

## What it is for

Retrieval, with the source shown. It is at its best on questions of the form
"what did we say about…", "when did this change and why", and "has anyone
raised this already" — questions where the answer exists somewhere in a hundred
messages you do not want to scroll.

It pairs well with an `@`-reference. Name the epic or feature you mean, then
ask the discussion question, and the retrieval narrows to that part of the
work. See
[Giving the assistant context](/docs/ai-assistant/context-and-mentions).

## It respects your permissions

The index is not a back door. Retrieval runs as you, checked against your live
project access at the moment you ask:

- Content from a **project you cannot open** is never returned.
- Content from a **channel you are not a member of** is never returned, even
  though it sits in a project you can open.
- If a **permission is removed** from you, the material behind it stops being
  retrievable for you immediately — there is no stale copy that keeps
  answering.

Two people on the same project can therefore get different answers to the same
question, and that is correct rather than a fault. See
[Fine-tuning permissions](/docs/projects/permissions).

## What it is not

**It is not file search.** The knowledge base indexes written discussion and
project records. Attachments and files in the resources library are not the
same thing as messages about them, and you should not assume the contents of an
uploaded document are searchable this way.

**It is not a replacement for the Decisions register.** This is the important
one. Retrieval is good at surfacing something that was said; it is not a
guarantee that the thing was decided, that the decision still stands, or that
the message you get back is the last word rather than the first. A chat thread
where four people argued and one of them was right looks, to an index, like
four opinions.

When something needs to be findable on purpose — an agreed scope change, a
technology choice, an acceptance criterion — write it into the register that
exists for it. A [decision record](/docs/delivery-governance/decisions) carries
the options you considered, a category, and a final state that says the matter
is closed. A [change request](/docs/delivery-governance/change-requests) records
that scope moved and who agreed to it. Those are records; chat is a transcript.

> Use the knowledge base to find what was said. Use a register to establish what
> was decided.

## Check the citation before acting

Every retrieved answer shows where it came from. Open it before you act on it —
particularly before you let the assistant change the roadmap on the strength of
it.

Three things are worth checking in the source:

1. **The date.** A decision from four months ago may have been superseded by a
   conversation the index also holds.
2. **The speaker.** "We could move the launch" from someone thinking aloud
   reads identically to the same sentence from the person who gets to decide.
3. **What came after it.** A cited message is one message. The reply two lines
   down may reverse it.

If the answer is going to become work, the safe sequence is: read the citation,
confirm it still holds, then ask the assistant to make the change — and review
the diff it proposes before committing it, as with every structural edit. See
[Reviewing and committing AI changes](/docs/ai-assistant/reviewing-changes).

## Where to go next

- [The AI assistant](/docs/ai-assistant/overview)
- [Giving the assistant context](/docs/ai-assistant/context-and-mentions)
- [Decisions](/docs/delivery-governance/decisions)
