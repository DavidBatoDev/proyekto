/**
 * Deterministic default roadmap thumbnails.
 *
 * Produces an SVG data URI (gradient background + up-to-2-char initials) from a
 * stable seed (roadmap id, or the name when no id exists yet). Used as the
 * create form's "Generate one for me" fallback so a thumbnail is always
 * available, and its algorithm is mirrored by the backfill migration
 * (supabase/migrations/20260701120000_backfill_and_require_roadmap_preview_url.sql)
 * for legacy rows. Dependency-free so both sides stay in sync.
 */

// Gradient palette [from, to]. Kept in sync with the backfill SQL palette.
const GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ["#f97316", "#ec4899"], // orange -> pink (brand)
  ["#6366f1", "#8b5cf6"], // indigo -> violet
  ["#0ea5e9", "#06b6d4"], // sky -> cyan
  ["#10b981", "#22c55e"], // emerald -> green
  ["#f59e0b", "#ef4444"], // amber -> red
  ["#8b5cf6", "#d946ef"], // violet -> fuchsia
];

/** Stable non-negative 32-bit string hash (djb2). */
function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Up-to-2-char uppercase initials from a name (mirrors getAvatarDisplay). */
function initialsFromName(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return initials || "R";
}

/** XML-escape text before embedding it in the SVG markup. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build a deterministic gradient + initials thumbnail as an SVG data URI.
 *
 * @param seed  Stable identifier (roadmap id, or the name when no id yet).
 * @param name  Display name used to derive the initials.
 */
export function generateRoadmapThumbnailDataUri(
  seed: string,
  name: string,
): string {
  const [from, to] =
    GRADIENTS[hashString(seed || name || "roadmap") % GRADIENTS.length];
  const initials = escapeXml(initialsFromName(name || "Roadmap"));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360" role="img" aria-label="${initials}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><text x="320" y="180" fill="#ffffff" fill-opacity="0.95" font-family="Inter, system-ui, sans-serif" font-size="140" font-weight="700" text-anchor="middle" dominant-baseline="central">${initials}</text></svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
