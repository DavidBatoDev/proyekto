import type { PdfTextItem } from './pdf-layout';

/**
 * Finds the x offset that separates a two-column page, or null for one column.
 *
 * Mode-based, not clustering-based, and the difference matters. A first attempt
 * ran 1-D k-means over every item's x and then required the two clusters to be
 * spatially disjoint. It rejected a genuine two-column LinkedIn export, because
 * text runs do not all start at a column edge: a wrapped sidebar line contains
 * continuation runs at arbitrary x (105, 152, ...), and one of those always
 * overlaps the other cluster's range, so the disjointness test fails and the
 * whole document collapses into a single column.
 *
 * Column starts, by contrast, are sharply bimodal — on a real export, 35 runs
 * begin at x=224 and 18 at x=22, with the strays appearing once each. Picking
 * the two heaviest bins ignores the strays by construction.
 *
 * The boundary sits just LEFT of the main column's start rather than midway
 * between the modes. Midway (≈123) would cut through the sidebar's own text and
 * push its wrapped continuations into the main column; the sidebar is wide, and
 * what has to be separated is where lines BEGIN.
 */
export function findColumnBoundary(
  items: PdfTextItem[],
  options: { minSeparation?: number; binSize?: number; minShare?: number } = {},
): number | null {
  const { minSeparation = 120, binSize = 4, minShare = 0.12 } = options;
  if (items.length < 8) return null;

  const bins = new Map<number, number>();
  for (const item of items) {
    const bin = Math.round(item.x / binSize) * binSize;
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }

  const ranked = [...bins.entries()].sort((a, b) => b[1] - a[1]);
  const [primary, primaryCount] = ranked[0];

  const secondary = ranked.find(
    ([x, count]) =>
      Math.abs(x - primary) >= minSeparation &&
      count >= items.length * minShare,
  );
  if (!secondary) return null;
  if (primaryCount < items.length * minShare) return null;

  const [left, right] =
    primary < secondary[0] ? [primary, secondary[0]] : [secondary[0], primary];

  // A little left of the right-hand column's start: far enough that the
  // sidebar's widest wrapped line stays on its own side.
  const boundary = right - binSize * 2.5;
  return boundary > left ? boundary : null;
}
