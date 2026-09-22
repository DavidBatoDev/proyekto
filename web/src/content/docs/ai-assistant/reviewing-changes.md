When the assistant wants to change the shape of a roadmap, it does not simply
change it. It proposes the change, Proyekto renders that proposal as a diff you
can read, and the roadmap stays exactly as it was until you say go. This page
is about that gap between proposal and reality, and what to do inside it.

## Stage one: the preview

Ask for anything structural — add an epic, move five features, push a phase out
by three weeks — and the assistant replies with a proposal card instead of a
finished result.

The card is a *semantic* diff, not a list of database operations. It describes
the change in the vocabulary of the roadmap:

| The diff says | What it means |
| --- | --- |
| **Added** | A new epic, feature or task that does not exist yet |
| **Moved** | An existing item re-parented under a different epic or feature |
| **Renamed** | The title changes; the item and its children are the same item |
| **Re-dated** | A feature's start or end date changes |
| **Removed** | An item, and everything beneath it, is deleted |

Where the proposal spans more than one roadmap — possible from the dashboard
rail — the card groups its changes per roadmap so you can see which plan each
one lands in.

Read the diff before you read the assistant's prose about the diff. The prose
is a summary; the diff is the contract.

## Stage two: the commit

Nothing has happened yet. The proposal has two exits:

**Apply this plan** commits it. The operations run, the roadmap updates, and
the panel shows a commit card confirming what landed — with a link back into
the roadmap or timeline view so you can look at the result in place.

**Discard plan** throws it away. This costs nothing. No partial state is left
behind, no item is half-created, and the roadmap is bit-for-bit what it was
before you asked. Discarding is not a failure state and does not need to be
cleaned up afterwards; if a proposal is 80% right, discard it and re-ask with
the correction rather than committing and repairing.

> A discarded proposal leaves no trace. Discard freely.

## Reading the diff carefully

Two kinds of operation are worth a second look, because they are the ones that
read as innocuous and are not.

**Nested moves.** When an item moves, everything under it moves too. A diff
line that moves one feature is also moving that feature's tasks, their
checklists, their comments and their assignees. The diff names the item that
moved, not every descendant that travelled with it — so check what is
underneath the thing being moved, not just the thing itself.

**Date changes.** Dates live on features, so a request phrased in terms of a
whole epic ("push Checkout to Q3") appears in the diff as a re-date on each
feature inside it. Several date lines for one instruction is normal. What is
worth checking is the *span*: confirm the new end dates are what you expected
and that a shift has not silently compressed or stretched a feature.

The operation to look hardest at is a **removal** you did not ask for. An
instruction like "tidy up the duplicate epics" gives the assistant latitude to
decide what a duplicate is. If a removal appears and you did not name that
item, discard and re-ask naming exactly what should go.

## Reverting after the fact

Committing is not the end of the line. Every structural change to a roadmap —
whether it came from the assistant, from you dragging things around the canvas,
or from an integration — is recorded as a change you can inspect and roll back.

Open the roadmap's change history, find the commit, and revert it. There is no
separate "AI undo": it is the same mechanism that covers manual edits, which is
the point. See
[Change history and rollback](/docs/roadmaps-and-work/change-history).

## Why it works this way

A single edit is easy to undo by hand. You can see it happen, and reversing it
is one drag.

A bulk restructure is not. Fifteen features re-parented across four epics, with
dates adjusted to match, is a change nobody reconstructs from memory a day
later — and the moment you are not sure exactly what changed, you stop trusting
the roadmap. The preview exists so that the expensive change is the one you
looked at, and the cheap change is the one you threw away.

It is also why the diff is semantic rather than technical. A list of raw
operations is auditable but not readable, and a change nobody reads is not
really being reviewed.

## Through MCP, too

If your workspace uses the MCP server to connect Claude or another MCP host to
Proyekto, roadmap writes made that way go through exactly the same two stages:
the host previews the operations and obtains a revision token, then commits
with it. A connected tool cannot skip the preview, and it cannot do anything
your own permissions would not allow. MCP is a Pro-and-above feature and may
not be enabled on your workspace — see
[Connect Proyekto to Claude (MCP)](/docs/account-and-apps/mcp-server).

## Where to go next

- [The AI assistant](/docs/ai-assistant/overview) — scopes, threads and memory
- [Change history and rollback](/docs/roadmaps-and-work/change-history)
- [Building a roadmap](/docs/roadmaps-and-work/building-a-roadmap)
