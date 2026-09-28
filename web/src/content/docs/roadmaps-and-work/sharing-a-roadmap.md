A share link puts a roadmap in front of someone who does not have an account —
a client, a stakeholder, a prospective partner — without adding them to your
workspace or your project. It is a tokenized URL: whoever holds it gets in, at
the level you chose, and nothing more.

## Creating a link

From the roadmap, create a share link and pick its level. There are two:

| Level | They can | They cannot |
| --- | --- | --- |
| **Viewer** | Read the roadmap — its epics, features, tasks and dates | Comment, or change anything |
| **Commenter** | Everything a viewer can, plus leave comments on nodes | Change any structure, status or date |

Copy the link and send it however you like. There is no invitation to accept and
no account to create.

## There is no editor share link

You cannot share a roadmap for editing, on purpose.

> Editing requires knowing who you are. A tokenized link is held by whoever it
> was forwarded to, and a forwarded link that could restructure your plan is a
> plan you no longer control.

Everything that writes to a roadmap is attributed — every structural change
lands in [history](/docs/roadmaps-and-work/change-history) with an author. A
link cannot be an author. If someone genuinely needs to edit, give them
[project access](/docs/projects/access-and-roles) as **editor**; that is a
per-person grant with a name attached, and you can remove it later.

## What the recipient sees

They see the roadmap: the tree of epics, features and tasks, their statuses and
dates, and the views that render that structure.

They do **not** see the rest of the project. A share link is not project access,
and this is the point worth saying plainly:

> A share link reaches the roadmap and nothing else. Not chat, not the
> governance registers, not the resources library, not the board, not meetings,
> not the team list.

So a client holding a viewer link cannot read your channel where the team is
arguing about the estimate, cannot open the risks register, and cannot see who
else is on the project. If you want them inside those things, that is project
access, granted per person.

## Commenter links in practice

A commenter link lets someone leave comments on individual nodes — which is
usually what "can you look at this plan?" actually means.

Their comments appear to your team exactly where team comments appear: on the
node, in the project, visible to everyone with access. Your team replies from
inside Proyekto as normal. The comment is attributed to the identity the
commenter gave, so it is clear which remarks came from outside.

Comments are not structural changes. A commenter can say "this date looks
optimistic"; they cannot move the date.

## Revoking a link

Revoke a share link at any time.

Revocation is immediate and it applies to **everyone holding that link** — the
person you sent it to and anyone they forwarded it to. The next time any of them
loads it, the link no longer resolves. There is no per-recipient revocation,
because there are no per-recipient identities: a token is a token.

Treat that as the trade. A link is the fastest way to show someone a plan and
the least precise way to control who sees it. For anything sensitive, or for a
relationship that will last months, grant project access instead and manage it
per person.

Revoking does not affect comments already left through the link. They stay on
the nodes where they were made.

## Links other people sent you

Roadmaps shared with you gather on the **Shared with me** page, so a link you
were sent in a chat message six weeks ago is still findable. It lists the
roadmaps you have access to via a share link, at whatever level that link
grants.

If a link stops working, it was revoked or replaced by whoever owns the roadmap.
Ask them for a fresh one.

## Share link, or project access?

| | Share link | [Project access](/docs/projects/access-and-roles) |
| --- | --- | --- |
| **Needs an account** | No | Yes |
| **Reaches** | One roadmap | The whole project, at the level you grant |
| **Levels** | Viewer, commenter | owner → admin → editor → commenter → viewer, with per-person toggles |
| **Revoked** | For everyone holding the link | Per person |
| **Costs a seat** | No | No — project access is separate from workspace membership |

Neither one makes someone a member of your workspace. See
[Core concepts](/docs/start-here/core-concepts) for why membership and access
are deliberately different things.
