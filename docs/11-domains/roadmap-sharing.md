# Roadmap Sharing

> **Last updated:** 2026-07-09 · **Status:** current

A roadmap can be shared outside its project — a Google-Docs-style tokenized link that
grants read-only or comment access without a full project membership. Recipients see
the roadmap and (if allowed) can comment on epics and features.

## The model

| Table | Holds |
| --- | --- |
| `roadmap_shares` | Share config: `share_token`, `invited_emails` (jsonb), `default_role` |

There is **no separate access-grant table** — access lives in the `share_token` (for
link access) and the `invited_emails` jsonb (for named invitees). The `default_role`
is limited to **viewer** or **commenter** (sharing never grants edit).

## What you can do

- **Create / get / remove** a share for a roadmap: `POST/GET/DELETE /roadmap-shares/:id`.
- **Open a shared roadmap by token** (public): `GET /roadmap-shares/token/:shareToken`.
- **See roadmaps shared with you**: `GET /roadmap-shares/shared-with-me`.
- **Comment on a shared epic/feature**: `POST /roadmap-shares/epic/:id/comments`,
  `POST /roadmap-shares/feature/:id/comments`.

The token route is the only **public** (unauthenticated) entry point; everything else
requires auth ([Backend → api reference](../03-backend/api-reference.md#roadmap-shares--roadmap-shares)).

## Templates (related)

Separate from sharing, a roadmap can be marked a **template** and cloned:
`GET /roadmaps/templates/public` (public), `POST /roadmaps/:id/clone-from-template`,
and consultant template management. Templates are about reuse; shares are about
read/comment access to a specific roadmap.

## How access is decided

Share access resolves through the roadmap authorization helpers
(`can_view_roadmap`, `get_user_roadmap_effective_role`) which fold in project access,
share tokens, and invited emails. See
[Data → RLS & security](../07-data-and-db/rls-and-security.md).

## Code locations

- **Backend:** [`backend/src/modules/roadmap-shares/`](../../backend/src/modules/roadmap-shares/)
- **Web:** `web/src/routes/roadmap/shared/`, `web/src/routes/roadmap/shared-with-me.tsx`

## See also

- [Product → roadmap & milestones](../01-product/roadmap-and-milestones.md) — the roadmap model being shared.
