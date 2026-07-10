# Guests

> **Last updated:** 2026-07-09 · **Status:** current

Anonymous users can build a roadmap **before signing up** — typically from the hero
chat — and their work migrates to a real account when they register. There's no
separate guest table: a guest is just a `profiles` row flagged `is_guest`.

## How a guest exists

- A guest is created via the `create_guest_user` RPC, producing a `profiles` row with
  `is_guest = true` and a `guest_session_id`.
- The client identifies as that guest with an **`x-guest-user-id`** header (not a
  JWT). `SupabaseAuthGuard` accepts it, verifying the session is a real guest profile
  and **not older than 30 days**. See
  [Backend → auth & guards](../03-backend/auth-and-guards.md).
- Guests are read-limited and rate-limited: `POST /guests/create` (5/60s) and
  `GET /guests/by-session/:sessionId` (30/60s) are throttled public endpoints.

## What a guest can do

Enough to build a roadmap with the AI assistant and preview shared content — but not
project actions. Guest callers are explicitly blocked from converting flows like
`POST /projects/from-roadmap` and `POST /roadmaps/migrate` until they're a real user.

## Migration to a real account

On signup, the guest's roadmap(s) migrate to the new authenticated user:

- `POST /roadmaps/migrate` (rejects guest callers — the *authenticated* user claims
  the guest's work).
- Web side: `web/src/services/migration.service.ts` orchestrates the handoff.

> Don't confuse this **guest→user** migration with the **Supabase Storage → R2**
> file migration — different thing, see [Storage & Media](../08-storage-media/README.md).

## Housekeeping

Old guest profiles are cleaned up via the `cleanup_old_guest_users` RPC
(`POST /guests/cleanup`, any authenticated user). Guest session validity is checked by
`is_valid_guest_session`.

## Code locations

- **Backend:** [`backend/src/modules/guests/`](../../backend/src/modules/guests/)
- **RPCs:** `create_guest_user`, `get_guest_user_id`, `is_valid_guest_session`, `cleanup_old_guest_users`
- **Web:** `web/src/services/migration.service.ts`

## See also

- [Product → personas](../01-product/personas.md) — where guests sit in the model.
- [Agent & Roadmap AI](../05-agent-ai/README.md) — the AI flow guests use to build a roadmap.
