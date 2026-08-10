# Consultants

> **Last updated:** 2026-08-10 · **Status:** current

Consultants are Proyekto's vetted delivery operators. Consultant identity begins at signup,
but consultant capability begins only after admin approval. The canonical predicate is:

```ts
profile.role === "consultant" && profile.is_consultant_verified === true
```

The code calls that state an **active consultant**. It protects talent discovery, consultant
project creation, finance, template publishing, rate-sensitive operations, and the public
consultant directory.

## Identity lifecycle

```text
Consultant signup
  -> role='consultant', verified=false
  -> personal team provisioned
  -> application draft -> submitted -> admin review
  -> admin provisions team again (idempotent)
  -> role='consultant', verified=true
  -> active-consultant tools unlock
```

The role is assigned before vetting so onboarding identity is honest. Verification is a
separate capability bit and cannot be self-granted by a browser session.

## Documentation index

| Doc | What's in it |
| --- | --- |
| [consultant-structure.md](./consultant-structure.md) | Account identity, application, public directory, project ownership, and the absence of a consultant profile table |
| [vetting-and-capabilities.md](./vetting-and-capabilities.md) | Application states, approval, the shared active predicate, and protected operations |
| [access-and-permissions.md](./access-and-permissions.md) | Consultant project origin, owner grants, additive operator permissions, and reassignment |
| [user-flows.md](./user-flows.md) | Signup through approval, project creation, talent hiring, delivery, billing, and reassignment |
| [consultant-surfaces.md](./consultant-surfaces.md) | Public, authenticated, active-only, project, team, and finance routes |

## Glossary

| Term | Meaning |
| --- | --- |
| **Consultant account** | A profile with `profiles.role='consultant'`, verified or not. |
| **Active consultant** | Consultant role plus `is_consultant_verified=true`. |
| **Consultant application** | Vetting record in `consultant_applications`; not the consultant's profile. |
| **Consultant origin** | `project_access.origin='consultant'`, an additive project-permission delta rather than account identity. |
| **Personal team** | Idempotently provisioned team used as the consultant's delivery container. |

## Known gaps

- There is no role-specific Consultant dashboard; shared dashboards and navigation remain in
  use, with active-only items hidden or redirected individually.
- A Consultant account that is not verified can still use ordinary authenticated and
  project-member surfaces. Only consultant powers require the active predicate.
- The application endpoints are authenticated but not restricted to Consultant accounts;
  approval can promote a Client or Talent applicant by setting both role and verification.
- Account role is durable and user-non-switchable, but admin approval is an intentional
  promotion path.

## Code locations

- **Predicate and guard:** [`backend/src/common/auth/consultant-capability.ts`](../../../backend/src/common/auth/consultant-capability.ts), [`backend/src/common/guards/consultant-only.guard.ts`](../../../backend/src/common/guards/consultant-only.guard.ts)
- **Applications and approval:** [`backend/src/modules/applications/`](../../../backend/src/modules/applications/), [`backend/src/modules/admin/`](../../../backend/src/modules/admin/)
- **Consultant directory:** [`backend/src/modules/consultants/`](../../../backend/src/modules/consultants/)
- **Web:** [`web/src/routes/consultant/`](../../../web/src/routes/consultant/), [`web/src/routes/finance/`](../../../web/src/routes/finance/)
