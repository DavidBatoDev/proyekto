#!/usr/bin/env bash
#
# One-time data transfer: Supabase Storage -> Cloudflare R2.
#
# Copies every object from the Supabase storage buckets into the two R2 buckets
# (public assets -> proyekto-media, identity documents -> proyekto-private),
# preserving the bucket name as the R2 key prefix so the app's URL rewrite
# (supabase/migrations/20260621150000_rewrite_storage_urls_to_r2.sql) lines up.
#
# `rclone copy` is incremental, so this script is safe to re-run — run it once
# for the bulk copy, then again right before cutover to catch any stragglers.
#
# Prerequisites — configure two rclone S3 remotes first (rclone config):
#   [supabase]  type = s3, provider = Other,
#               endpoint = https://<ref>.supabase.co/storage/v1/s3,
#               region = <project region>, access_key_id/secret = Supabase S3 keys
#   [r2]        type = s3, provider = Cloudflare,
#               endpoint = https://<account-id>.r2.cloudflarestorage.com,
#               access_key_id/secret = R2 S3 API token
#
# Usage:
#   scripts/migrate_storage_to_r2.sh           # copy
#   scripts/migrate_storage_to_r2.sh --check   # verify only (rclone check), no copy
set -euo pipefail

SUPABASE_REMOTE="${SUPABASE_REMOTE:-supabase}"
R2_REMOTE="${R2_REMOTE:-r2}"
PUBLIC_BUCKET="${R2_PUBLIC_BUCKET:-proyekto-media}"
PRIVATE_BUCKET="${R2_PRIVATE_BUCKET:-proyekto-private}"

PUBLIC_SOURCES=(avatars banners project_banners portfolio_projects roadmap_previews task_attachments)
PRIVATE_SOURCES=(identity_documents)

MODE="copy"
if [[ "${1:-}" == "--check" ]]; then MODE="check"; fi

if ! command -v rclone >/dev/null 2>&1; then
  echo "error: rclone is not installed or not on PATH" >&2
  exit 1
fi

run_one() {
  local src="$1" dest="$2"
  if [[ "$MODE" == "check" ]]; then
    echo "==> check ${SUPABASE_REMOTE}:${src}  vs  ${R2_REMOTE}:${dest}"
    rclone check "${SUPABASE_REMOTE}:${src}" "${R2_REMOTE}:${dest}" --one-way
  else
    echo "==> copy ${SUPABASE_REMOTE}:${src}  ->  ${R2_REMOTE}:${dest}"
    rclone copy "${SUPABASE_REMOTE}:${src}" "${R2_REMOTE}:${dest}" -P
  fi
}

for b in "${PUBLIC_SOURCES[@]}"; do
  run_one "$b" "${PUBLIC_BUCKET}/${b}"
done

for b in "${PRIVATE_SOURCES[@]}"; do
  run_one "$b" "${PRIVATE_BUCKET}/${b}"
done

echo "Done (${MODE})."
