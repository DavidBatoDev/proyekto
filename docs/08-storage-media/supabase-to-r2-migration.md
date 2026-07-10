# Supabase Storage → R2 Migration

> **Last updated:** 2026-07-09 · **Status:** current

Storage is moving off **Supabase Storage** onto **Cloudflare R2**. New uploads
already go to R2 (see [r2-architecture.md](./r2-architecture.md)); this page is about
moving the **existing** objects and rewriting their URLs. There's a wrinkle: the
database moved to Singapore, but the stored files still live on the **old Mumbai**
Supabase project — so the copy source and the URL-rewrite target are different
projects.

> **Status:** code and the URL-rewrite migration are done; the bulk data copy is the
> operational step. Don't delete the Mumbai storage project until the R2 copy is
> verified complete.

## The moving parts

1. **Bulk copy** — `scripts/migrate_storage_to_r2.sh` uses `rclone copy` (S3 remotes)
   to move every object from the Supabase buckets into the two R2 buckets, preserving
   the bucket name as the R2 key prefix so the app's URL rewrite lines up.
2. **URL rewrite** — `supabase/migrations/20260621150000_rewrite_storage_urls_to_r2.sql`
   rewrites stored asset URLs (avatars, banners, etc.) from Supabase Storage URLs to
   `cdn.proyekto.tech` R2 URLs.

## Bucket mapping

| Supabase source buckets | → R2 bucket |
| --- | --- |
| `avatars`, `banners`, `project_banners`, `portfolio_projects`, `roadmap_previews`, `task_attachments` | `proyekto-media` (public) |
| `identity_documents` | `proyekto-private` |

Each source bucket becomes a key prefix inside the R2 bucket
(`proyekto-media/avatars/…`), matching what the URL rewrite expects.

## The source/target split

- **Copy source = Mumbai.** The files still live on the old Supabase project
  (`ftuiloyegcipkupbtias`, Mumbai) — the rclone `[supabase]` remote points there.
- **URL-rewrite target = Singapore.** The database (where the URLs are stored) is the
  live Singapore project (`byvbnkpiselvvulsvxgo`), applied via the migration.

See [Architecture → deploy topology](../02-architecture/deploy-topology.md) and
[Data → migrations workflow](../07-data-and-db/migrations-workflow.md).

## Running it

```bash
# configure two rclone S3 remotes first (rclone config):
#   [supabase] endpoint https://<mumbai-ref>.supabase.co/storage/v1/s3
#   [r2]       endpoint https://<account-id>.r2.cloudflarestorage.com
scripts/migrate_storage_to_r2.sh            # incremental copy (safe to re-run)
scripts/migrate_storage_to_r2.sh --check    # verify only (rclone check --one-way)
```

`rclone copy` is incremental, so run it once for the bulk copy, then again right
before cutover to catch stragglers. `--check` verifies parity without copying.

## Cutover checklist

1. Bulk `rclone copy` (both public + private sources).
2. Apply the URL-rewrite migration on the Singapore DB.
3. Re-run the copy to catch any objects written since step 1.
4. `--check` to confirm parity.
5. Spot-check assets load from `cdn.proyekto.tech` in the app.
6. Only then consider retiring the Mumbai storage project.

> **⚠️** Two different "migrations" share a name — this is **files → R2**. The
> **guest → user** roadmap migration is unrelated (see
> [Feature Domains → guests](../11-domains/guests.md)).
