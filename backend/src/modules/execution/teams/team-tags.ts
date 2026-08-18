/**
 * Freeform descriptive labels on a team.
 *
 * These are labels in the same sense `project_access.origin` is a label: they
 * describe, they never authorize. Nothing in this codebase may gate a
 * capability on a tag, so normalization here is about storage hygiene, not
 * safety.
 */

export const TEAM_TAG_MAX_COUNT = 20;
export const TEAM_TAG_MAX_LENGTH = 40;

/**
 * Canonicalize freeform team tags: trim, collapse inner whitespace, drop
 * empties, truncate to TEAM_TAG_MAX_LENGTH, dedupe case-insensitively keeping
 * the first spelling the user typed, and cap at TEAM_TAG_MAX_COUNT.
 *
 * Insertion order is preserved deliberately - the order a user typed their
 * labels in is the only ordering signal there is, and sorting would discard it.
 * Accepts `unknown` so a malformed payload degrades to `[]` rather than
 * throwing past the DTO layer.
 */
export function normalizeTeamTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of input) {
    if (typeof raw !== 'string') continue;

    const tag = raw.replace(/\s+/g, ' ').trim().slice(0, TEAM_TAG_MAX_LENGTH);
    if (!tag) continue;

    const key = tag.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(tag);
    if (out.length >= TEAM_TAG_MAX_COUNT) break;
  }

  return out;
}
