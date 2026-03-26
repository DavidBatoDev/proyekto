# API Reference

All routes are prefixed with `/api`. Authentication is required unless marked **Public**.

Legend: 🔒 = JWT required · 👤 = guest also accepted · 🌐 = public · 🛡️ = admin only

---

## Auth — `/api/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/auth/profile` | 🔒 | Get current user's profile |
| `POST` | `/auth/onboarding` | 🔒 | Submit initial onboarding data |
| `PATCH` | `/auth/onboarding/complete` | 🔒 | Mark onboarding as complete |
| `PATCH` | `/auth/persona` | 🔒 | Switch active persona (`client`/`consultant`) |
| `PATCH` | `/auth/profile` | 🔒 | Update profile display fields |

---

## Users — `/api/users`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/users/me` | 🔒 | Current user's full account record |
| `PATCH` | `/users/me` | 🔒 | Update account fields |
| `GET` | `/users/:id/public` | 🌐 | Public profile (limited fields) |

---

## Profile — `/api/profile`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/profile` | 🔒 | Full profile (parallel-fetched) |
| `PATCH` | `/profile/basic` | 🔒 | Update bio, headline, location |
| `PUT` | `/profile/skills` | 🔒 | Replace entire skills list |
| `POST` | `/profile/languages` | 🔒 | Add language |
| `PATCH` | `/profile/languages/:id` | 🔒 | Update language |
| `DELETE` | `/profile/languages/:id` | 🔒 | Remove language |
| `POST` | `/profile/education` | 🔒 | Add education entry |
| `PATCH` | `/profile/education/:id` | 🔒 | Update education entry |
| `DELETE` | `/profile/education/:id` | 🔒 | Delete education entry |
| `POST` | `/profile/certifications` | 🔒 | Add certification |
| `PATCH` | `/profile/certifications/:id` | 🔒 | Update certification |
| `DELETE` | `/profile/certifications/:id` | 🔒 | Delete certification |
| `POST` | `/profile/experience` | 🔒 | Add work experience |
| `PATCH` | `/profile/experience/:id` | 🔒 | Update work experience |
| `DELETE` | `/profile/experience/:id` | 🔒 | Delete work experience |
| `POST` | `/profile/portfolio` | 🔒 | Add portfolio item |
| `PATCH` | `/profile/portfolio/:id` | 🔒 | Update portfolio item |
| `DELETE` | `/profile/portfolio/:id` | 🔒 | Delete portfolio item |
| `PUT` | `/profile/rate-settings` | 🔒 | Upsert rate/availability settings |
| `POST` | `/profile/licenses` | 🔒 | Add professional license |
| `PATCH` | `/profile/licenses/:id` | 🔒 | Update license |
| `DELETE` | `/profile/licenses/:id` | 🔒 | Delete license |
| `POST` | `/profile/specializations` | 🔒 | Add specialization |
| `PATCH` | `/profile/specializations/:id` | 🔒 | Update specialization |
| `DELETE` | `/profile/specializations/:id` | 🔒 | Delete specialization |
| `POST` | `/profile/identity-documents` | 🔒 | Add identity document |
| `DELETE` | `/profile/identity-documents/:id` | 🔒 | Delete identity document |

---

## Projects — `/api/projects`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/projects` | 🔒 | List projects for current user |
| `POST` | `/projects` | 🔒 | Create project (auto-adds creator as member) |
| `GET` | `/projects/:id` | 🔒 | Get project by ID |
| `PATCH` | `/projects/:id` | 🔒 | Update project (owner only) |
| `DELETE` | `/projects/:id` | 🔒 | Delete project (owner only) |

---

## Payments — `/api/payments`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/payments/checkpoints` | 🔒 | Create payment checkpoint |
| `GET` | `/payments/checkpoints/:id` | 🔒 | Get checkpoint by ID |
| `POST` | `/payments/checkpoints/:id/fund` | 🔒 | Fund escrow (calls `fund_escrow` RPC) |
| `POST` | `/payments/checkpoints/:id/release` | 🔒 | Release escrow (calls `release_milestone` RPC) |
| `POST` | `/payments/checkpoints/:id/refund` | 🔒 | Refund escrow (calls `refund_escrow` RPC) |
| `GET` | `/payments/wallet` | 🔒 | Get current user's wallet |
| `GET` | `/payments/transactions` | 🔒 | List wallet transactions |
| `POST` | `/payments/admin/deposit` | 🛡️ | Admin manual deposit |
| `GET` | `/payments/admin/wallets` | 🛡️ | List all wallets |

---

## Admin — `/api/admin`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/admin/applications` | 🛡️ | List consultant applications |
| `GET` | `/admin/applications/:id` | 🛡️ | Get application detail |
| `PATCH` | `/admin/applications/:id/approve` | 🛡️ | Approve application |
| `PATCH` | `/admin/applications/:id/reject` | 🛡️ | Reject application with reason |
| `GET` | `/admin/match-candidates` | 🛡️ | Skill-overlap match candidates for a project |
| `POST` | `/admin/match-assign` | 🛡️ | Assign matched consultant to project |
| `GET` | `/admin/profiles` | 🛡️ | List all profiles |
| `GET` | `/admin/profiles/:id` | 🛡️ | Get profile by ID |
| `PATCH` | `/admin/profiles/:id/verify` | 🛡️ | Mark consultant as verified |
| `PATCH` | `/admin/profiles/:id/suspend` | 🛡️ | Suspend user |
| `GET` | `/admin/stats` | 🛡️ | Platform statistics |
| `POST` | `/admin/grant` | 🛡️ | Grant admin access to a user |
| `GET` | `/admin/admins` | 🛡️ | List all admins |
| `DELETE` | `/admin/admins/:id` | 🛡️ | Revoke admin access |

---

## Consultants — `/api/consultants`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/consultants` | 🌐 | List verified consultants |
| `GET` | `/consultants/:id` | 🌐 | Get consultant public profile |

---

## Applications — `/api/applications`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/applications` | 🔒 | Submit consultant application |
| `GET` | `/applications/me` | 🔒 | Get current user's application |
| `DELETE` | `/applications/:id` | 🔒 | Withdraw application |

---

## Uploads — `/api/uploads`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/uploads/signed-url` | 🔒 | Generate a Supabase Storage signed upload URL |
| `POST` | `/uploads/confirm-avatar` | 🔒 | Confirm avatar upload, update profile |
| `POST` | `/uploads/confirm-banner` | 🔒 | Confirm banner upload, update profile |
| `DELETE` | `/uploads/avatar` | 🔒 | Delete avatar from storage and profile |

---

## Guests — `/api/guests`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/guests/create` | 🌐 | Create a guest session profile |
| `GET` | `/guests/by-session/:sessionId` | 🌐 | Get guest profile by session ID |
| `POST` | `/guests/migrate` | 🔒 | Migrate guest data to authenticated account |
| `GET` | `/guests/pending/:sessionId` | 🌐 | Get pending guest items |
| `POST` | `/guests/cleanup` | 🔒 | Delete expired guest sessions |

---

## Roadmaps — `/api/roadmaps`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/roadmaps` | 🔒 | List user's roadmaps |
| `GET` | `/roadmaps/preview` | 🔒 | Lightweight preview list (id, name, status) |
| `GET` | `/roadmaps/user/:userId` | 🔒 | Roadmaps by specific user |
| `POST` | `/roadmaps/migrate` | 🔒 | Migrate guest roadmaps to account |
| `GET` | `/roadmaps/:id` | 🔒 | Get roadmap |
| `GET` | `/roadmaps/:id/full` | 🔒 | Full roadmap with all nested data |
| `POST` | `/roadmaps` | 🔒 | Create roadmap |
| `PATCH` | `/roadmaps/:id` | 🔒 | Update roadmap (owner only) |
| `DELETE` | `/roadmaps/:id` | 🔒 | Delete roadmap (owner only) · 204 |

## Milestones — `/api/milestones`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/roadmaps/:roadmapId/milestones` | 🔒 | List milestones for roadmap |
| `POST` | `/roadmaps/:roadmapId/milestones` | 🔒 | Create milestone |
| `GET` | `/milestones/:id` | 🔒 | Get milestone |
| `PATCH` | `/milestones/:id` | 🔒 | Update milestone |
| `PATCH` | `/milestones/:id/reorder` | 🔒 | Update milestone position |
| `DELETE` | `/milestones/:id` | 🔒 | Delete milestone · 204 |

## Epics — `/api/epics`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/epics/roadmap/:roadmapId` | 🔒 | List epics for roadmap |
| `POST` | `/epics` | 🔒 | Create epic |
| `GET` | `/epics/:id` | 🔒 | Get epic |
| `PATCH` | `/epics/:id` | 🔒 | Update epic |
| `PATCH` | `/epics/reorder` | 🔒 | Bulk reorder epics |
| `DELETE` | `/epics/:id` | 🔒 | Delete epic · 204 |

## Features — `/api/features`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/features/epic/:epicId` | 🔒 | Features in an epic |
| `GET` | `/features/roadmap/:roadmapId` | 🔒 | All features in a roadmap |
| `POST` | `/features` | 🔒 | Create feature |
| `GET` | `/features/:id` | 🔒 | Get feature |
| `PATCH` | `/features/:id` | 🔒 | Update feature |
| `PATCH` | `/features/reorder` | 🔒 | Bulk reorder features |
| `POST` | `/features/link-milestone` | 🔒 | Link feature to milestone |
| `DELETE` | `/features/unlink-milestone` | 🔒 | Unlink feature from milestone |
| `DELETE` | `/features/:id` | 🔒 | Delete feature · 204 |

## Tasks — `/api/tasks`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/tasks/feature/:featureId` | 🔒 | Tasks for a feature |
| `POST` | `/tasks` | 🔒 | Create task |
| `GET` | `/tasks/:id` | 🔒 | Get task |
| `PATCH` | `/tasks/:id` | 🔒 | Update task |
| `PATCH` | `/tasks/reorder` | 🔒 | Bulk reorder tasks |
| `DELETE` | `/tasks/:id` | 🔒 | Delete task · 204 |

## Task Extras — `/api/tasks/:taskId`

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/tasks/:taskId/comments` | 🔒 | List task comments |
| `POST` | `/tasks/:taskId/comments` | 🔒 | Add comment |
| `PATCH` | `/tasks/comments/:id` | 🔒 | Update comment (author only) |
| `DELETE` | `/tasks/comments/:id` | 🔒 | Delete comment (author only) |
| `GET` | `/tasks/:taskId/attachments` | 🔒 | List task attachments |
| `POST` | `/tasks/:taskId/attachments` | 🔒 | Add attachment |
| `DELETE` | `/tasks/attachments/:id` | 🔒 | Delete attachment (uploader only) |

---

## Roadmap Shares — `/api/roadmap-shares`

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/roadmap-shares/:id` | 🔒 | Create/update share link for roadmap |
| `GET` | `/roadmap-shares/:id` | 🔒 | Get share settings for roadmap |
| `DELETE` | `/roadmap-shares/:id` | 🔒 | Deactivate share link · 204 |
| `GET` | `/roadmap-shares/token/:shareToken` | 🌐 | Access roadmap by share token |
| `GET` | `/roadmap-shares/shared-with-me` | 🔒 | List roadmaps shared with current user |
| `POST` | `/roadmap-shares/epic/:id/comments` | 👤 | Add comment to shared epic |
| `POST` | `/roadmap-shares/feature/:id/comments` | 👤 | Add comment to shared feature |

---

## Planned (Not Yet Implemented) - AI Roadmap Editing

> The routes below are design targets only and are **not implemented yet**.
> Full architecture and contracts: `./08-AI-ROADMAP-EDITOR-ARCHITECTURE.md`

### FastAPI Agent Service (Separate from NestJS)

These routes are expected to live in the standalone FastAPI `agent` service, not under NestJS `/api`.

| Method | Path | Status | Description |
|---|---|---|---|
| `POST` | `/agent/sessions` | Planned | Create AI editing session |
| `POST` | `/agent/sessions/:sessionId/messages` | Planned | Parse intent and orchestrate tool calls |
| `POST` | `/agent/sessions/:sessionId/preview` | Planned | Build/refresh preview from draft operations |
| `POST` | `/agent/sessions/:sessionId/commit` | Planned | Commit approved preview |
| `POST` | `/agent/sessions/:sessionId/rollback` | Planned | Request rollback to prior revision |

### Planned NestJS Roadmap AI Endpoints

These routes are planned additions to the current NestJS roadmap module.

| Method | Path | Status | Description |
|---|---|---|---|
| `POST` | `/roadmaps/:id/ai/preview` | Planned | Validate `operations[]`, generate semantic diff, return candidate state |
| `POST` | `/roadmaps/:id/ai/commit` | Planned | Revalidate + transactionally persist approved preview |
| `POST` | `/roadmaps/:id/ai/rollback` | Planned | Restore roadmap state to selected revision |

### Planned Request/Response Fields

- Preview request: `roadmap_id`, `base_revision`, `operations[]`
- Preview response: `preview_id`, `validation_issues[]`, `semantic_diff`, `candidate_snapshot`
- Commit request: `preview_id`, `base_revision`
- Commit response: `new_revision`, `semantic_diff`, `committed_at`

### Planned Operation Types

- `find_node`
- `add_epic`, `add_feature`, `add_task`
- `move_node`
- `update_node`
- `delete_node`
- `link_dependency`, `unlink_dependency`
- `shift_dates`
- `mark_status`
- `preview_changes`, `commit_changes`, `rollback`

### Planned Validation/Error Codes

- `MISSING_REQUIRED_FIELD`
- `INVALID_TYPE`
- `INVALID_ENUM`
- `DUPLICATE_ID`
- `BROKEN_RELATIONSHIP`
- `DEPENDENCY_CYCLE`
- `INVALID_DATE_RANGE`
- `HIERARCHY_VIOLATION`
- `PROGRESS_MISMATCH`
- `STALE_REVISION`
- `OUT_OF_SCOPE_MUTATION`
