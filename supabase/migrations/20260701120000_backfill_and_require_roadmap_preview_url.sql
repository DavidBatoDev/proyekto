-- Require a thumbnail (preview_url) for every roadmap.
--
-- Roadmap cards render `roadmaps.preview_url` as the thumbnail. We now require
-- one for every roadmap (enforced in the backend CreateRoadmapDto and here in
-- the DB). Existing rows may have a NULL preview_url, so we first backfill them
-- with a deterministic gradient + initials thumbnail (an SVG data URI), then add
-- the NOT NULL constraint.
--
-- The gradient palette and "up-to-2-char initials" mirror the web generator in
-- web/src/lib/roadmapThumbnail.ts (generateRoadmapThumbnailDataUri) so legacy
-- and newly generated defaults look consistent. The web util percent-encodes the
-- SVG; here we base64-encode it — both are equivalent, browser-renderable data
-- URIs. Idempotent: the WHERE clause only touches rows still missing a preview.

WITH palette (gi, c_from, c_to) AS (
  VALUES
    (0, '#f97316', '#ec4899'), -- orange -> pink (brand)
    (1, '#6366f1', '#8b5cf6'), -- indigo -> violet
    (2, '#0ea5e9', '#06b6d4'), -- sky -> cyan
    (3, '#10b981', '#22c55e'), -- emerald -> green
    (4, '#f59e0b', '#ef4444'), -- amber -> red
    (5, '#8b5cf6', '#d946ef')  -- violet -> fuchsia
),
computed AS (
  SELECT
    r.id,
    -- Deterministic palette index 0..5 from the first byte of md5(id).
    (get_byte(decode(md5(r.id::text), 'hex'), 0) % 6) AS gi,
    -- Up-to-2-char uppercase initials from the first two "words" of the name,
    -- after stripping characters that could break the SVG/XML.
    coalesce(
      nullif(
        upper(left(split_part(nmc, ' ', 1), 1) || left(split_part(nmc, ' ', 2), 1)),
        ''
      ),
      'R'
    ) AS initials
  FROM (
    SELECT
      id,
      nullif(
        trim(
          regexp_replace(
            coalesce(nullif(trim(name), ''), 'Roadmap'),
            '[^[:alnum:][:space:]]', ' ', 'g'
          )
        ),
        ''
      ) AS nmc
    FROM public.roadmaps
    WHERE preview_url IS NULL
  ) r
)
UPDATE public.roadmaps t
SET preview_url =
  'data:image/svg+xml;base64,' ||
  replace(
    encode(
      convert_to(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">'
        || '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        || '<stop offset="0" stop-color="' || p.c_from || '"/>'
        || '<stop offset="1" stop-color="' || p.c_to || '"/>'
        || '</linearGradient></defs>'
        || '<rect width="640" height="360" fill="url(#g)"/>'
        || '<text x="320" y="180" fill="#ffffff" fill-opacity="0.95" '
        || 'font-family="Inter, system-ui, sans-serif" font-size="140" font-weight="700" '
        || 'text-anchor="middle" dominant-baseline="central">' || c.initials || '</text>'
        || '</svg>',
        'UTF8'
      ),
      'base64'
    ),
    E'\n', ''
  )
FROM computed c
JOIN palette p ON p.gi = c.gi
WHERE t.id = c.id;

-- Every roadmap now has a thumbnail; enforce it going forward.
ALTER TABLE public.roadmaps ALTER COLUMN preview_url SET NOT NULL;
