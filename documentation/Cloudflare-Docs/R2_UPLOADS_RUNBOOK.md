# R2 Uploads Runbook — Worker vs. Backend Proxy

How file uploads to Cloudflare R2 work today, and **how to switch the upload path
back to the backend** if/when you want to reconsider it.

> TL;DR — Uploads currently go **browser → Cloudflare Worker → R2 (native binding)**.
> A **backend proxy** (`POST /api/uploads/file`) is fully built and deployed but
> **dormant**. To switch back, repoint one function in the web app and redeploy —
> but only after confirming the R2 **S3 endpoint** works from Cloud Run (see §4).

---

## 1) Background — why we're on the Worker

Reads were never a problem: all assets serve from the public R2 bucket over the
custom domain `https://cdn.proyekto.tech`.

Writes were. The "obvious" designs both write through R2's **S3 API endpoint**
`https://<account_id>.r2.cloudflarestorage.com`, and that endpoint failed the
**TLS handshake** (`SSL alert 40, handshake_failure`) from *every* network we
tried — the browser (ISP SNI-filtering of `*.r2.cloudflarestorage.com`), this
dev machine, **and Google Cloud Run** (the new account's per-endpoint TLS cert
was unprovisioned — a known Cloudflare new-account issue). See
`documentation/Cloudflare-Docs/` history and the project memory for the full
diagnosis.

The **Worker R2 binding** (`env.MEDIA.put(...)`) is Cloudflare's recommended
server-side write path and **never touches the S3 endpoint**, so it's immune to
both the cert issue and any client-network filtering. That's why it's the default.

## 2) The two upload paths

| | **Worker (current default)** | **Backend proxy (dormant)** |
|---|---|---|
| Flow | browser → `…workers.dev/uploads` → `env.MEDIA/PRIVATE.put()` | browser → `api.proyekto.tech/api/uploads/file` → aws-sdk `PutObjectCommand` |
| Touches R2 S3 endpoint? | **No** (native binding) | **Yes** (Cloud Run → `*.r2.cloudflarestorage.com`) |
| Works while S3 endpoint is broken? | **Yes** | No (500 `handshake_failure`) |
| Immune to client ISP S3 filtering? | Yes (browser only hits workers.dev) | Yes (browser only hits the backend) |
| Auth | Worker verifies Supabase JWT | `SupabaseAuthGuard` |
| Validation (bucket/size/MIME) | in the Worker (`realtime/src/index.ts`) | in `UploadsService` |
| Bytes pass through | Cloudflare edge | Cloud Run (CPU + egress) |
| Infra to maintain | the `realtime/` Worker | none extra |

Both return the same shape conceptually — public buckets → a `cdn.proyekto.tech`
URL, the private `identity_documents` bucket → a bare object key.

## 3) Where each path lives in the code

**Worker (current):**
- `realtime/src/index.ts` — `POST /uploads` route + `handleUpload` + CORS + `UPLOAD_BUCKETS`.
- `realtime/wrangler.toml` — `MEDIA`/`PRIVATE` R2 bindings + `R2_PUBLIC_BASE_URL` var.
- `realtime/src/types.ts` — `Env.MEDIA/PRIVATE/R2_PUBLIC_BASE_URL`.
- Web points here: `web/src/services/upload.service.ts` → `UPLOAD_WORKER_URL` (env `VITE_UPLOAD_WORKER_URL`, defaults to the deployed worker).
- Deploys via `.github/workflows/realtime-deploy.yml` on push to `main` (paths `realtime/**`).
- Introduced in commit `7d2c7d2`.

**Backend proxy (dormant fallback):**
- `backend/src/modules/uploads/uploads.controller.ts` — `POST file` (`@Post('file')`, multipart `FileInterceptor`) + `UploadsService.uploadFile`.
- `backend/src/config/r2.module.ts` — the `R2_CLIENT` S3 client (with `requestChecksumCalculation: WHEN_REQUIRED` for R2 compatibility).
- R2 secrets are already in GCP Secret Manager + wired in `.github/workflows/backend-deploy.yml`.
- Introduced in commits `056362e` (+ `ee7640e` checksum fix).

## 4) Precondition before switching back — the S3 endpoint must work from Cloud Run

The backend proxy only works once `Cloud Run → *.r2.cloudflarestorage.com` succeeds
(i.e., Cloudflare has provisioned the account's S3 endpoint cert). **Verify first**
by hitting the dormant endpoint — it's still deployed:

```bash
# 1) get a user access token (Supabase password grant)
SUPA_URL=https://byvbnkpiselvvulsvxgo.supabase.co   # the live (Singapore) project
TOK=$(curl -s -X POST "$SUPA_URL/auth/v1/token?grant_type=password" \
  -H "apikey: <VITE_SUPABASE_ANON_KEY>" -H "Content-Type: application/json" \
  -d '{"email":"<user>","password":"<pass>"}' \
  | grep -o '"access_token":"[^"]*"' | head -1 | cut -d'"' -f4)

# 2) hit the backend proxy directly (creates a throwaway object on success)
curl -s -X POST "https://api.proyekto.tech/api/uploads/file" \
  -H "Authorization: Bearer $TOK" \
  -F "bucket=avatars" -F "file=@C:/path/to/test.png;type=image/png"
```

- **Success** → JSON with `"publicUrl":"https://cdn.proyekto.tech/avatars/…"` (delete the test object afterward via `wrangler r2 object delete proyekto-media/<path>`).
- **Still broken** → `{"error":"... SSL alert ... handshake failure ...","status":500}`. Do **not** switch; stay on the Worker.

## 5) Switch uploads: Worker → Backend

1. In `web/src/services/upload.service.ts`, change `upload()` to POST to the backend
   instead of the worker (this is exactly what commit `056362e` had — you can copy it
   from `git show 056362e:web/src/services/upload.service.ts`):
   - URL: `` `${API_BASE_URL}${this.base}/file` `` (i.e. `https://api.proyekto.tech/api/uploads/file`), with `API_BASE_URL` re-imported from `@/api/axios`.
   - Response parse: backend wraps responses, so read `body.data.publicUrl` (the worker returns `body.publicUrl`).
2. Commit + push to `main` → Vercel redeploys the web. (No backend change needed; the endpoint is already live.)
3. **Verify** an upload in the app (avatar/banner/task attachment) lands and the URL is `cdn.proyekto.tech/...`.
4. *(Optional)* retire the Worker upload path: remove the `POST /uploads` route + `MEDIA`/`PRIVATE` bindings from `realtime/`, and the `VITE_UPLOAD_WORKER_URL` plumbing. Only do this once the backend path is confirmed stable.

## 6) Switch back the other way: Backend → Worker

Reverse of §5: repoint `upload()` at `` `${UPLOAD_WORKER_URL}/uploads` `` and read
`body.publicUrl` (see commit `7d2c7d2`). The Worker route + bindings are already in
`realtime/`. Redeploy web. No Cloudflare clicks needed — `workers.dev` is reachable
and the worker deploys via CI.

## 7) Verifying the Worker path (current)

```bash
WK=https://proyekto-realtime.lucky-mud-7121.workers.dev
# (get $TOK as in §4, then)
curl -s -X POST "$WK/uploads" -H "Authorization: Bearer $TOK" \
  -H "Origin: https://www.proyekto.tech" \
  -F "bucket=avatars" -F "file=@C:/path/to/test.png;type=image/png"
# -> {"path":"avatars/<uid>/<ts>.png","publicUrl":"https://cdn.proyekto.tech/avatars/<uid>/<ts>.png"}
# then: curl -I that publicUrl -> 200; wrangler r2 object delete proyekto-media/<path>
```

## 8) Notes

- Keep the bucket/size/MIME rules **in sync** between `realtime/src/index.ts`
  (`UPLOAD_BUCKETS`) and `backend/.../uploads.controller.ts` (`BUCKET_CONFIG`) — both
  exist so either path enforces the same limits.
- Private bucket (`identity_documents`) returns a **bare object key**, not a URL,
  in both paths. Reading those back requires a presigned GET (not built yet).
- R2 buckets: `proyekto-media` (public, custom domain `cdn.proyekto.tech`),
  `proyekto-private` (no public access). Account id `5458839e949daf8bcfb403068a2c1f26`.
- If you ever need the **S3 API** itself (e.g. `rclone`, `aws-cli`) and it still
  fails the TLS handshake, that's the unprovisioned-cert issue — open a Cloudflare
  support/community request referencing the account id and the SNI evidence.
