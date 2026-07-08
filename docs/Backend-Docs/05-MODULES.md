# Module Breakdown

## AuthModule

**Path**: `src/modules/auth/`  
**Routes**: 5 · **Token**: `AUTH_REPOSITORY` (in `auth.service.ts`)

Handles post-Supabase-signup flow. Supabase manages password/session — this module manages the application-level profile lifecycle.

- `onboarding()` — creates/updates profile with role selection and basic info
- `completeOnboarding()` — marks `onboarding_completed = true`
- `switchPersona()` — validates `is_consultant_verified` before switching to `consultant`
- `updateProfile()` — updates display-level profile fields

---

## UsersModule

**Path**: `src/modules/users/`  
**Routes**: 3 · **Token**: `USERS_REPOSITORY` (in `users.service.ts`)

Account-level operations (distinct from profile). Exposes a public endpoint that returns limited fields only.

---

## ProfileModule

**Path**: `src/modules/profile/`  
**Routes**: 28+ · **Token**: `PROFILE_REPOSITORY` (in `profile.service.ts`)

The largest module. Manages all consultant profile sub-entities:

| Sub-entity | Table | Operations |
|---|---|---|
| Basic | `profiles` | PATCH |
| Skills | `consultant_skills` | PUT (replace all) |
| Languages | `consultant_languages` | POST / PATCH / DELETE |
| Education | `consultant_education` | POST / PATCH / DELETE |
| Certifications | `consultant_certifications` | POST / PATCH / DELETE |
| Experience | `consultant_experience` | POST / PATCH / DELETE |
| Portfolio | `consultant_portfolio` | POST / PATCH / DELETE |
| Rate Settings | `consultant_rate_settings` | PUT (upsert) |
| Licenses | `consultant_licenses` | POST / PATCH / DELETE |
| Specializations | `consultant_specializations` | POST / PATCH / DELETE |
| Identity Documents | `consultant_identity_documents` | POST / DELETE |

The `GET /profile` (full profile) uses **parallel Supabase queries** via `Promise.all()` to fetch all sub-entities simultaneously.

---

## ProjectsModule

**Path**: `src/modules/projects/`  
**Routes**: 5 · **Token**: `PROJECTS_REPOSITORY` (in `projects.service.ts`)

- `create()` — inserts into `projects`, then auto-inserts creator into `project_members`
- `update()` / `remove()` — owner-only authorization check in service layer

---

## PaymentsModule

**Path**: `src/modules/payments/`  
**Routes**: 9 · **Token**: `PAYMENTS_REPOSITORY` (in `payments.service.ts`)

Escrow-based payment flow via Supabase RPC functions:

| RPC Function | Trigger |
|---|---|
| `fund_escrow` | Client funds a milestone checkpoint |
| `release_milestone` | Client releases payment to consultant |
| `refund_escrow` | Admin/client refunds escrow |

Admin deposit and wallet listing use `SUPABASE_ADMIN` (service role) directly.

---

## AdminModule

**Path**: `src/modules/admin/`  
**Routes**: 14 · **Token**: `ADMIN_REPOSITORY` (in `admin.service.ts`)

All routes protected by `AdminGuard`. Key feature:

**`match-candidates`** — queries `consultant_skills` + `project_skills` and uses a **skill-overlap scoring algorithm** to rank consultants by suitability for a project.

---

## ConsultantsModule

**Path**: `src/modules/consultants/`  
**Routes**: 2 · **Auth**: Public

Simple public discovery for verified consultants. Directly injects `SUPABASE_ADMIN` — no repository layer needed for these read-only queries.

---

## ApplicationsModule

**Path**: `src/modules/applications/`  
**Routes**: 3 · **Token**: `APPLICATIONS_REPOSITORY` (in `applications.controller.ts`)

Consultant job application flow. `submit()` validates that required fields (CV, cover letter) are present before inserting.

---

## UploadsModule

**Path**: `src/modules/uploads/`  
**Routes**: 4

Manages file uploads via Supabase Storage **signed URLs**. A bucket config map controls which bucket handles which upload type:

```typescript
const BUCKET_MAP = {
  avatar: 'avatars',
  banner: 'banners',
  document: 'documents',
  portfolio: 'portfolio-files',
};
```

Flow: frontend requests signed URL → uploads directly to Supabase Storage → calls confirm endpoint to update profile record.

---

## GuestsModule

**Path**: `src/modules/guests/`  
**Routes**: 5 · **Auth**: Mixed (public + JWT)

Supports unauthenticated users (guests) who can create roadmaps before registering. On signup, `POST /guests/migrate` transfers all guest data (roadmaps, etc.) to their new account using the `session_id`.

---

## RoadmapsModule

**Path**: `src/modules/roadmaps/`  
**Routes**: 55+ · **Controllers**: 6 · **Services**: 6 · **Tokens**: 6

The most complex module. Manages the full roadmap hierarchy:

```
Roadmap
  └── Milestones (ordered by position)
  └── Epics (ordered by position)
        └── Features (ordered by position, linked to milestones via junction table)
              └── Tasks (ordered by position)
                    ├── Comments
                    └── Attachments
```

Reordering uses **bulk position updates** (each item in the update array gets its own Supabase query, all run in parallel via `Promise.all()`).

Feature ↔ Milestone links are stored in a `milestone_features` junction table.

---

## RoadmapSharesModule

**Path**: `src/modules/roadmap-shares/`  
**Routes**: 7 · **Token**: `ROADMAP_SHARES_REPOSITORY` (in `roadmap-shares.service.ts`)

Generates shareable links with:
- Permission levels: `viewer`, `commenter`, `editor`
- Optional expiry date
- Token generated with Node.js `crypto.randomBytes(24).toString('hex')`
- Expiry checked in service layer (throws `410 GoneException` if expired)

External viewers (non-authenticated) can add comments on epics/features via the `commenter_name` field.
