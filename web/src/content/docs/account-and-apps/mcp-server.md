Proyekto ships its own MCP server, so an AI client that speaks the Model
Context Protocol — Claude, Claude Code, Codex and other MCP hosts — can work
with your Proyekto data directly. Reading is the default; changing anything
requires scopes you grant explicitly. This page covers what it can do, how to
connect, and the two guarantees that make handing an AI client access
reasonable.

## It may not be switched on

The MCP server is optional. It ships behind a switch, so it may simply not be
enabled for your workspace, and it is available from Pro upward — see
[Plans](/docs/workspaces-and-plans/plans) for what each tier includes. If
**Settings → MCP Access** is not doing anything useful for you, ask a workspace
owner before planning a workflow around it.

## What a connected client can do

With read access, an MCP host can:

- List your projects and read a project's details and members.
- Read roadmaps, epics, features, tasks and their comments.
- Read and search chat channels.
- Read the delivery registers — deliverables, change requests, risks, decisions.
- Search project knowledge, where the knowledge base is enabled.
- Read your own AI planning threads.

With write scopes on top, it can create and update tasks, assign them, draft
register entries, post chat messages, create and edit projects, and stage
roadmap operations.

## Connecting

Two mechanisms, for two kinds of client. Both start at **Settings → MCP
Access**, which also shows the server endpoint to point your host at.

### Personal Access Token

For command-line hosts such as Claude Code and Codex. Create a token, tick the
scopes it should carry, and give it to your host as a bearer credential.

The token value is shown **once**, at creation. There is no way to retrieve it
afterwards — if you lose it, revoke it and issue a new one. The list afterwards
shows only a prefix, the scopes, when it was last used and when it expires.

### OAuth 2.1

For apps that can run a sign-in flow. The host sends you to Proyekto, you see a
**consent screen** naming the client and exactly the scopes it is asking for,
and you approve or decline. The flow uses PKCE, and refresh tokens rotate on
use, so a leaked refresh token stops working as soon as the legitimate client
uses its own.

Connections made this way appear under **Connected apps**, with the scopes they
hold and when they were last used.

## Scopes

Reads are the default; **every write needs its own explicit `*:write` scope**.
Granting "read roadmaps" never quietly grants the ability to edit one.

| Read | Write |
| --- | --- |
| `projects:read` | `projects:write` |
| `roadmaps:read` | `roadmaps:write` |
| `chat:read` | `chat:write` |
| `delivery:read` | `delivery:write` |
| `knowledge:read` | `tasks:write`, `tasks:assign` |
| `ai-sessions:read` | |

Assigning a task is its own scope because it notifies a person. Grant the
narrowest set that does the job; you can always issue a second token.

## Your permissions still apply

This is the part that makes the rest safe:

> Every tool call re-checks your live project authorisation, so a token can
> never do more than you can.

Scopes narrow what a token may attempt. They never widen it. If you are a
commenter on a project, a token carrying `roadmaps:write` still cannot edit that
project's roadmap — the check runs per call, against your current access, not
against whatever was true when the token was issued. Lose access to a project
tomorrow and every token you hold loses it at the same moment. See
[Fine-tuning permissions](/docs/projects/permissions) for what those checks are
reading.

## Roadmap writes stay two-stage

Structural roadmap changes through MCP work exactly as they do in the app: the
client previews the operations and receives a revision token, then commits with
it. There is no single-shot "rewrite the roadmap" call.

If the roadmap changed underneath in the meantime, the commit is rejected as
stale and the client has to re-read and re-preview rather than overwrite
somebody's work. The result is that an AI client's roadmap edits land as
reviewable changes you can inspect, and roll back afterwards, like any other —
see [Change history](/docs/roadmaps-and-work/change-history).

## Revoking

Revoke a Personal Access Token from its row in **Settings → MCP Access**, or a
connected app from **Connected apps**. Either takes effect immediately: the next
call from that credential fails. Revoking changes nothing about your account or
the data — it only stops that client talking to Proyekto.

Worth doing periodically: a token you issued for an experiment six months ago is
a credential you are no longer watching.
