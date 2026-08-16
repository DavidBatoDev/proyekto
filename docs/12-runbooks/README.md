# Runbooks & Ops

> **Last updated:** 2026-08-13 · **Status:** current

Operational procedures — the step-by-step guides for when you're rotating a secret,
validating the cache, vetting an applicant, or running a benchmark. Each is
self-contained and points back into the relevant section for the "why".

## Documentation index

| Doc                                                      | What's in it                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [google-oauth-email.md](./google-oauth-email.md)         | Keeping the Gmail credentials healthy; telling `invalid_client` from `invalid_grant` and recovering |
| [cloudflare-cache.md](./cloudflare-cache.md)             | Validating cache/no-store, 304s, edge purge; kill switches & rollback                               |
| [admin-vetting-playbook.md](./admin-vetting-playbook.md) | Admin review, consultant promotion, and verification over the `user_*` identity data                |
| [benchmarks-and-canary.md](./benchmarks-and-canary.md)   | Perf benchmarks, the agent canary, the shared-contract check                                        |
| [production-qa-fixture.md](./production-qa-fixture.md)   | Seeding, running, and recovering the guarded production billing fixture                             |

## Related runbooks elsewhere

Some operational content lives with its subject:

- [Storage → R2 (switch upload path)](../08-storage-media/r2-architecture.md#switching-the-upload-path-runbook)
- [Storage → Supabase→R2 migration](../08-storage-media/supabase-to-r2-migration.md)
- [Mobile → OTA publish/rollback](../09-mobile/ota-updates.md#publish--rollback)
- [Infra → Cloudflare rollout](../10-infra-deploy/cloudflare.md)
- [Feature Domains → meetings operations](../11-domains/meetings/operations.md)

## Code locations

- **Scripts:** [`scripts/`](../../scripts/)
- **Outbound email:** [`backend/src/common/mail/`](../../backend/src/common/mail/)
- **Backend cache:** [`backend/src/common/cache/`](../../backend/src/common/cache/)
