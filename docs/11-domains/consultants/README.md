# Consultants

> **Last updated:** 2026-08-10 · **Status:** current

Consultants are Proyekto's vetted delivery operators. There is no consultant account
identity — consultant capability begins at admin approval and nowhere else. The
canonical predicate is:

```ts
profile.is_consultant_verified === true
```

The code calls that state an **active consultant**. It is the only account-level
capability, and it protects talent discovery, consultant project creation, finance,
template publishing, rate-sensitive operations, and the public consultant directory.

## Capability lifecycle

```text
Signup (lane-free, same as everyone)
  -> application draft -> submitted -> admin review
  -> admin provisions personal team (idempotent)
  -> is_consultant_verified=true
  -> active-consultant tools unlock
```

Verification is a server-managed capability bit and cannot be self-granted by a
browser session (a privileged-columns trigger blocks anon/authenticated writes).

## Documentation index

| Doc | What's in it |
| --- | --- |
| [consultant-structure.md](./consultant-structure.md) | The capability bit, application, public directory, project ownership, and the absence of a consultant profile table |
| [vetting-and-capabilities.md](./vetting-and-capabilities.md) | Application states, approval, the shared active predicate, and protected operations |
| [access-and-permissions.md](./access-and-permissions.md) | Consultant project origin, owner grants, additive operator permissions, and reassignment |
| [user-flows.md](./user-flows.md) | Signup through approval, project creation, talent hiring, delivery, billing, and reassignment |
| [consultant-surfaces.md](./consultant-surfaces.md) | Public, authenticated, active-only, project, team, and finance routes |

## Glossary

| Term | Meaning |
| --- | --- |
| **Active consultant** | An account with `is_consultant_verified=true`; there is no unverified "consultant account" state. |
| **Consultant application** | Vetting record in `consultant_applications`; not the consultant's profile. |
| **Consultant origin** | `project_access.origin='consultant'`, an additive project-permission delta rather than account identity. |
| **Personal team** | Idempotently provisioned team used as the consultant's delivery container. |

## Known gaps

- There is no consultant-specific dashboard; shared dashboards and navigation remain in
  use, with active-only items hidden or redirected individually.
- An applicant awaiting approval can still use ordinary authenticated and
  project-member surfaces. Only consultant powers require the active predicate.
- The application endpoints are open to any authenticated user by design — vetting,
  not a declared identity, is the gate.

## Code locations

- **Predicate and guard:** [`backend/src/common/auth/consultant-capability.ts`](../../../backend/src/common/auth/consultant-capability.ts), [`backend/src/common/guards/consultant-only.guard.ts`](../../../backend/src/common/guards/consultant-only.guard.ts)
- **Applications and approval:** [`backend/src/modules/applications/`](../../../backend/src/modules/applications/), [`backend/src/modules/admin/`](../../../backend/src/modules/admin/)
- **Consultant directory:** [`backend/src/modules/consultants/`](../../../backend/src/modules/consultants/)
- **Web:** [`web/src/routes/consultant/`](../../../web/src/routes/consultant/), [`web/src/routes/finance/`](../../../web/src/routes/finance/)
