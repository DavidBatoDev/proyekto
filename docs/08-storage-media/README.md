# Storage & Media

> **Last updated:** 2026-07-09 · **Status:** current

File storage is on **Cloudflare R2** — two buckets (`proyekto-media` public,
`proyekto-private`), served publicly over `cdn.proyekto.tech`, with uploads going
through the realtime Worker. This section covers how uploads work and how existing
files migrate off Supabase Storage.

> If you only read one page, read [r2-architecture.md](./r2-architecture.md).

## Documentation index

| Doc | What's in it |
| --- | --- |
| [r2-architecture.md](./r2-architecture.md) | Buckets, the Worker vs backend-proxy upload paths, public/private routing, the switch runbook |
| [supabase-to-r2-migration.md](./supabase-to-r2-migration.md) | Moving existing files off Supabase Storage (Mumbai) with the URL rewrite |

## Glossary

| Term | Meaning |
| --- | --- |
| **Native binding** | The Worker's `env.MEDIA.put()` R2 access — bypasses the S3 endpoint. |
| **S3 endpoint** | `*.r2.cloudflarestorage.com` — R2's S3-compatible API; failed TLS handshakes, hence the Worker path. |
| **Public / private bucket** | `proyekto-media` (CDN-served) vs `proyekto-private` (presigned GET only). |
| **URL rewrite** | The migration that repointed stored asset URLs from Supabase Storage to `cdn.proyekto.tech`. |

## Code locations

- **Worker upload:** [`realtime/src/index.ts`](../../realtime/src/index.ts), [`realtime/wrangler.toml`](../../realtime/wrangler.toml)
- **Backend (dormant):** [`backend/src/modules/uploads/`](../../backend/src/modules/uploads/), [`backend/src/config/r2.module.ts`](../../backend/src/config/r2.module.ts)
- **Migration script:** [`scripts/migrate_storage_to_r2.sh`](../../scripts/migrate_storage_to_r2.sh)
- **Web:** `web/src/services/upload.service.ts`
