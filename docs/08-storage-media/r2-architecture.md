# R2 Architecture

> **Last updated:** 2026-07-09 · **Status:** current

All file storage is on **Cloudflare R2** — two buckets, a public CDN domain, and a
deliberate upload path. Reads are simple (public assets serve over
`cdn.proyekto.tech`); writes go **browser → Cloudflare Worker → R2 native binding**,
because R2's S3 API endpoint failed TLS handshakes from every network tried. A
backend proxy exists as a fully-built but dormant fallback.

> **TL;DR** — uploads: browser → the realtime Worker → `env.MEDIA/PRIVATE.put()`.
> The backend proxy (`POST /api/uploads/file`) is deployed but dormant; switching
> to it requires the R2 S3 endpoint to work from Cloud Run first.

## Buckets

| Bucket | Access | Serves |
| --- | --- | --- |
| `proyekto-media` | Public | All public assets over `https://cdn.proyekto.tech` |
| `proyekto-private` | Private | `identity_documents`, `payout_proofs` — presigned GET only |

The app namespaces objects by a logical bucket prefix (`avatars/`, `banners/`,
`identity_documents/`, …) inside these two R2 buckets. Account id
`5458839e949daf8bcfb403068a2c1f26`.

## The two upload paths

| | **Worker (current default)** | **Backend proxy (dormant)** |
| --- | --- | --- |
| Flow | browser → `…workers.dev/uploads` → `env.MEDIA/PRIVATE.put()` | browser → `api.proyekto.tech/api/uploads/file` → S3 `PutObjectCommand` |
| Touches R2 S3 endpoint? | **No** (native binding) | **Yes** (Cloud Run → `*.r2.cloudflarestorage.com`) |
| Works while S3 endpoint is broken? | **Yes** | No (500 `handshake_failure`) |
| Auth | Worker verifies Supabase JWT | `SupabaseAuthGuard` |
| Validation | Worker (`realtime/src/index.ts` `UPLOAD_BUCKETS`) | `UploadsService` (`BUCKET_CONFIG`) |
| Bytes flow through | Cloudflare edge | Cloud Run (CPU + egress) |

Both return the same shape conceptually: public buckets → a `cdn.proyekto.tech` URL;
the private bucket → a bare object key.

## Why the Worker path

The "obvious" designs write through R2's S3 endpoint
`https://<account>.r2.cloudflarestorage.com`, which failed the **TLS handshake**
(`SSL alert 40, handshake_failure`) from the browser (ISP SNI-filtering), the dev
machine, **and Cloud Run** (the new account's per-endpoint TLS cert was
unprovisioned — a known Cloudflare new-account issue). The **Worker R2 binding**
(`env.MEDIA.put(...)`) never touches the S3 endpoint, so it sidesteps both the cert
issue and client-network filtering. That's why it's the default.

## Public vs private routing

The `uploads` module (and the Worker) route by bucket:

- **Public** (`avatars`, `banners`, `project_banners`, `portfolio_projects`,
  `roadmap_previews`, `task_attachments`) → `proyekto-media`, resolvable at
  `${R2_PUBLIC_BASE_URL}/${bucket}/…` (`https://cdn.proyekto.tech`).
- **Private** (`identity_documents`, `payout_proofs`) → `proyekto-private`, returned
  as a bare key and read back only through a presigned GET.

See [Backend → modules (uploads)](../03-backend/modules.md) and
[Data → identity model](../07-data-and-db/identity-vetting-model.md).

## Where it lives

- **Worker:** [`realtime/src/index.ts`](../../realtime/src/index.ts) (`POST /uploads`,
  `handleUpload`, `UPLOAD_BUCKETS`), [`realtime/wrangler.toml`](../../realtime/wrangler.toml)
  (`MEDIA`/`PRIVATE` bindings, `R2_PUBLIC_BASE_URL`).
- **Backend proxy (dormant):** [`backend/src/modules/uploads/uploads.controller.ts`](../../backend/src/modules/uploads/uploads.controller.ts),
  [`backend/src/config/r2.module.ts`](../../backend/src/config/r2.module.ts)
  (the `R2_CLIENT` S3 client with `requestChecksumCalculation: WHEN_REQUIRED`).
- **Web:** `web/src/services/upload.service.ts` → `VITE_UPLOAD_WORKER_URL`.

## Switching the upload path (runbook)

The backend proxy only works once `Cloud Run → *.r2.cloudflarestorage.com` succeeds
(Cloudflare has provisioned the account's S3 cert). **Verify first** by POSTing a
test file to the still-deployed `POST /api/uploads/file`:

- **Success** → JSON with `"publicUrl":"https://cdn.proyekto.tech/avatars/…"` (delete
  the test object with `wrangler r2 object delete proyekto-media/<path>`).
- **Still broken** → `handshake_failure` 500 → stay on the Worker.

To switch **Worker → backend**: repoint `upload()` in `web/src/services/upload.service.ts`
at `${API_BASE_URL}/uploads/file` and read `body.data.publicUrl` (backend wraps
responses); push to `main` (Vercel redeploys). To switch back, repoint at
`${UPLOAD_WORKER_URL}/uploads` and read `body.publicUrl`. Keep the bucket/size/MIME
rules in sync between `realtime/src/index.ts` and `uploads.controller.ts` — both exist
so either path enforces the same limits.

## See also

- [supabase-to-r2-migration.md](./supabase-to-r2-migration.md) — moving existing files off Supabase Storage.
- [Realtime](../06-realtime/README.md) — the Worker that also carries uploads.
