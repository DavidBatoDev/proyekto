The assistant is only as good as the thing you pointed it at. Typing `@` in the
composer opens a picker of real objects from your workspace, and choosing one
attaches that object to your message rather than a phrase the assistant has to
go and identify. It is the difference between "the login epic" and *the* login
epic.

## What resolves

Start typing `@` followed by a name and the picker filters as you go.

| Reference | Use it for |
| --- | --- |
| **Project** | "Summarise where @Acme Rebuild stands" |
| **Roadmap** | Pointing at one plan when a project has several |
| **Epic** | Restructuring or reporting on one initiative |
| **Feature** | Re-dating, splitting, or adding tasks under it |
| **Task** | A specific piece of execution |
| **Member** | Identifying a person — "move @Priya's open tasks to next week" |

Pick one and it becomes a chip in your message. Chips also appear in the
assistant's replies, where they link straight to the item — so a summary of
five blocked tasks is five links, not five titles you then search for.

## Why naming beats describing

A description is a search the assistant has to run and might get wrong. Two
epics called "Onboarding" in different projects, three features whose titles
all begin "Migrate" — each is a chance for the assistant to work confidently on
the wrong item and hand you a diff that looks plausible.

A reference removes that step entirely. It passes the item's identity, so the
assistant reads that exact record — its children, dates, status and comments —
and starts from data instead of from a guess.

> References bias what the assistant looks at first. They do not fence it in:
> it may still read other things it has access to when the answer needs them.

That is deliberate. "Compare @Checkout with the rest of the roadmap" would be
unanswerable if the reference were a hard boundary.

## Inside a roadmap, versus on the dashboard

Where you are typing changes what is worth referencing.

**Inside a roadmap**, the assistant is already pointed at that roadmap. You
rarely need to reference the roadmap itself; references are for narrowing —
naming the epic, feature or task you mean out of everything on the canvas.

**On the dashboard rail**, the assistant works across everything you can
access, so a reference is how you say which project you are even talking about.
This is where cross-project questions belong: pull in two projects, or a
roadmap from one and an epic from another, and ask for the comparison. A
dashboard thread with no references at all is a broad question, and you will
get a broad answer.

See [The AI assistant](/docs/ai-assistant/overview) for how the two scopes
differ.

## Mentioning a person does not notify them

This one catches people out, so it is worth being blunt about.

> `@`-mentioning a colleague in an assistant thread sends them nothing. They
> are not notified, and they cannot see the thread.

A member reference exists so the assistant knows *which person* you mean — for
assigning a task, filtering by owner, or reporting on someone's workload. It is
not a way to bring them into the conversation.

If you want a person to actually hear about something, use
[project chat](/docs/chat-and-meetings/project-chat) or a comment on the task.
Those do notify — as does assigning someone a task.

## What the assistant can never see

The assistant reads as you, through your own access, on every request.

- **Projects you have no access to** do not appear in the picker and are not
  readable. Pasting in a name or a link does not change that.
- **Surfaces a permission has hidden from you** stay hidden. If a fine-grained
  permission keeps you out of a project's time logs or a register, asking the
  assistant does not route around it.
- **Private channels and direct messages you are not part of** are not
  readable, even where the knowledge base is switched on.

There is no elevated mode. If you can see it, the assistant can; if you cannot,
neither can it. See
[Fine-tuning permissions](/docs/projects/permissions).

## Combining references with the knowledge base

References point at *structure* — the plan, its items, its dates. Questions of
the "what did we decide about X" kind are about *discussion*, which lives in
chat, comments, activity and briefs.

Where the [project knowledge base](/docs/ai-assistant/knowledge-base) is
enabled, the two work well together: reference the epic or feature to say
which part of the work you mean, then ask the discussion question. The
reference narrows the retrieval, and the answer comes back with the source it
drew on so you can check it.

The knowledge base ships behind a switch and may not be on for your project. If
it is off, the assistant answers from the roadmap alone — it will not invent a
conversation it cannot read.

And for anything that genuinely needs to be findable later, write it down on
purpose. A [decision record](/docs/delivery-governance/decisions) is a register
entry with options, rationale and a final state; a message in a channel is a
thing somebody said once.

## Where to go next

- [The AI assistant](/docs/ai-assistant/overview)
- [Reviewing and committing AI changes](/docs/ai-assistant/reviewing-changes)
- [The project knowledge base](/docs/ai-assistant/knowledge-base)
