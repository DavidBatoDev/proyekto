# Client Access and Permissions

> **Last updated:** 2026-08-13 · **Status:** current

A client's 45 permissions are never stored. They are recomputed on every check from three
layers, and only the *delta* from the baseline is persisted — so role templates can evolve
without a backfill. Client origin now explicitly closes team-wide Time visibility at every
role, keeping delivery rates and aggregate internal costs out of client-mode projects.

## The resolution

```
resolvePermissions(role, origin, capabilities)
  = ROLE_DEFAULTS[role]      // coarse baseline for the rank
  ⊕ ORIGIN_DELTAS[origin]    // patch by grant source, regardless of rank
  ⊕ capabilities             // per-member overrides; flat paths win
```

— [`project-permissions.ts:515`](../../../backend/src/modules/execution/projects/permissions/project-permissions.ts)

```mermaid
flowchart LR
    R["ROLE_DEFAULTS[role]<br/><i>viewer → owner ladder</i>"]
    O["ORIGIN_DELTAS[origin]<br/><i>client / consultant /<br/>invited / personal_workspace</i>"]
    C["capabilities jsonb<br/><i>stored delta only</i>"]
    P["45 resolved booleans"]
    M["mentions.invite_by_email<br/><i>folded in afterwards</i>"]

    R --> O --> C --> P
    P --> M
    M --> OUT["ProjectPermissions"]

    style R fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    style O fill:#fef9c3,stroke:#ca8a04,color:#713f12
    style C fill:#dcfce7,stroke:#16a34a,color:#14532d
    style M fill:#fae8ff,stroke:#a21caf,color:#701a75
```

Each layer overwrites the previous one path-by-path. `capabilities` holds only what differs
from the `(role, origin)` baseline — `diffCapabilities()` computes that minimal set on write.

## The client origin delta

```ts
client: {
  'chat.message_freelancers': false,
  'time.view_team_logs': false,
  // Billing stays open; team-wide Time is the delivery cost side.
},
```

That is the entire delta — two paths. Compare the consultant delta, which adds four
capabilities *additively regardless of role*:

| Origin | Delta |
| --- | --- |
| `client` | `chat.message_freelancers: false`, `time.view_team_logs: false` |
| `consultant` | `chat.message_freelancers`, `members.manage`, `teams.manage`, `time.view_team_logs` → all `true` |
| `invited` | `{}` — pure role baseline |
| `personal_workspace` | every path → `true` |

> **The two denials have different reach.** `chat.message_freelancers` changes the resolved
> result only at owner. `time.view_team_logs` is granted by the admin baseline, so the client
> delta actively removes it from client-origin admins and owners. `access.time` remains true:
> clients can use their own-logs experience without seeing team-wide rates or costs.

## How a client actually gets created

Two paths, both in `ProjectsService.createProject`:

| `creation_mode` | Role granted | Origin | Notes |
| --- | --- | --- | --- |
| `'client'` (**default**) | `admin` | `client` | No owner exists until a consultant joins |
| `'consultant'` | `owner` | `consultant` | Requires `consultant_profiles.status='verified'`; forces `status: 'draft'` |

A client invited to an existing project instead gets whatever `project_invites.default_role`
says, with `origin` set by the grant call — see [user-flows.md](./user-flows.md).

## Resolved matrix

The two configurations that actually occur. `admin + client` is the project creator in the
default mode; `viewer + client` is a typical invited stakeholder.

| Path | `viewer` + client | `admin` + client | `owner` + client |
| --- | --- | --- | --- |
| `access.roadmap` / `work_items` / `team` / `chat` / `resources` / `time` | ✅ | ✅ | ✅ |
| `access.project_settings` | ❌ | ✅ | ✅ |
| `roadmap.view` / `roadmap.export` | ✅ | ✅ | ✅ |
| `roadmap.comment` | ❌ | ✅ | ✅ |
| `roadmap.edit` / `assign` / `edit_metadata` / `create_tasks` / `edit_tasks` / `share` | ❌ | ✅ | ✅ |
| `roadmap.promote` / `view_internal` / `dev_mode` | ❌ | ✅ | ✅ |
| `members.view` / `teams.view` | ✅ | ✅ | ✅ |
| `members.manage` / `edit_permissions` / `edit_position` / `teams.manage` | ❌ | ✅ | ✅ |
| `project.settings` / `edit_content` / `view_internal_content` | ❌ | ✅ | ✅ |
| `chat.view_channels` | ✅ | ✅ | ✅ |
| `chat.send_messages` / `mention_members` / `start_dm` / `send_dm` | ❌ | ✅ | ✅ |
| `chat.share_files` / `create_channels` / `manage_channels` / `view_internal_channels` | ❌ | ✅ | ✅ |
| `chat.message_clients` / `chat.message_consultants` | ✅ | ✅ | ✅ |
| **`chat.message_freelancers`** | ❌ | ❌ | **❌ ← the delta bites here** |
| `resources.view` | ✅ | ✅ | ✅ |
| `resources.upload` / `resources.delete` | ❌ | ✅ | ✅ |
| `logs.view` | ✅ | ✅ | ✅ |
| `logs.view_sensitive` | ❌ | ✅ | ✅ |
| `time.view_team_logs` | ❌ | ❌ | ❌ |

Derived from `buildRoleDefault()` and `ORIGIN_DELTAS` in
[`project-permissions.ts`](../../../backend/src/modules/execution/projects/permissions/project-permissions.ts).
Regenerate rather than transcribe if the file changes.

> **On money and time.** Clients retain `access.time` and their own-log experience, but the
> client-origin delta denies `time.view_team_logs` even when the stored role is admin or
> owner. Dashboard counts and hours remain visible; `time.total_fees` is returned only for
> projects where the resolved permission includes team-log visibility.

## Contract party access

Contract access is position-based rather than inferred from project role:

| Action | Client position |
| --- | --- |
| Read a live or severed contract | `client_user_id`, or the distinct live project owner when no client seat is stored |
| Sign the client party | Same rule; the project owner arm explicitly excludes the consultant seat |
| Edit, unsign, or move a signature | Not allowed; these remain consultant-only writes |
| Sign a severed contract | Not allowed; severed contracts are durable read-only history |

The authenticated contract link in a notification therefore opens the same contract the
client is authorized to read and sign. Token signing uses the same enrollment and severance
checks as in-app signing.

## Two paths that are deliberately not permissions

- **`mentions.invite_by_email`** is folded in *after* resolution by
  `ProjectsService.getMyPermissions`, and is absent from `PERMISSION_PATHS` on purpose — so
  `allTrue()` cannot fabricate it for an owner and an admin cannot hand it to a viewer. It
  gates on a **role comparison** plus a feature switch, because the enforcing service uses
  `assertRole('admin')` while `ORIGIN_DELTAS` hands `members.manage` to client and consultant
  origins regardless of rank. The two would disagree if it used the permission.
- **`assertRole` vs `assertPermission`.** They are not interchangeable. `roleSatisfies` compares
  ranks; `members.manage` is granted by origin. An editor-role consultant holds
  `members.manage` while `assertRole('admin')` refuses them. Anything that must agree with
  enforcement has to compare roles.

## Dependencies

`PERMISSION_DEPENDENCIES` declares prerequisites (e.g. `roadmap.edit` requires `roadmap.view`
and `access.roadmap`; `resources.delete` requires `resources.upload`). `validateDependencies()`
returns the unmet set so the permission editor can refuse an incoherent grant rather than
persisting one.

## The web mirrors

Three files mirror the backend model **by hand** and must be updated in the same change:

| File | Holds |
| --- | --- |
| [`permissionCatalog.ts`](../../../web/src/components/project/permissions/permissionCatalog.ts) | The path list and human labels for the permission editor |
| [`roleTemplates.ts`](../../../web/src/components/project/permissions/roleTemplates.ts) | Preset builders + `detectPreset()` |
| [`project.service.ts`](../../../web/src/services/project.service.ts) | The `ProjectPermissions` TypeScript shape |

> **⚠️** Nothing checks mirror parity at build time — unlike the activity vocabulary, which
> `npm run check:activity-actions` guards. Drift here is silent and shows up as a permission
> checkbox that does nothing.

## Enforcement layers

```mermaid
sequenceDiagram
    participant C as Client browser
    participant G as RequireProjectAccess
    participant A as SupabaseAuthGuard
    participant S as ProjectAuthorizationService
    participant DB as Postgres RLS

    C->>G: open /project/:id/roadmap
    G->>S: GET /projects/:id/permissions/me
    S->>S: resolvePermissions(role, origin, capabilities)
    S-->>G: 45 booleans
    alt access.roadmap false
        G-->>C: PermissionDeniedBanner
    else granted
        G-->>C: render route body
    end
    C->>A: mutate roadmap
    A->>S: assertPermission('roadmap.edit')
    S-->>A: MissingPermissionException on failure
    Note over DB: RLS is a second, coarser gate.<br/>The backend uses the service role,<br/>so TS authorization is the primary one.
```

The frontend gate is a UX affordance, not a security boundary — it stops a blank screen, not
a determined caller. Every mutation re-checks server-side.

## See also

- [client-surfaces.md](./client-surfaces.md) — which gate guards which route.
- [Backend → auth & guards](../../03-backend/auth-and-guards.md) — the guard inventory.
- [Data → RLS and security](../../07-data-and-db/rls-and-security.md) — why RLS is secondary.
