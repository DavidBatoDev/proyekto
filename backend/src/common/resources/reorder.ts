import { BadRequestException } from '@nestjs/common';

export interface ReorderItem {
  id: string;
  position: number;
}

/**
 * Validate a reorder payload against the container it claims to reorder.
 *
 * Shared by project resources and team resources, which run the same
 * positioning scheme. It is deliberately strict — a partial payload is rejected
 * rather than merged — because positions are enforced by partial UNIQUE indexes
 * in Postgres. A payload that moves one item without restating the rest cannot
 * be applied without either colliding or silently leaving gaps, and a gap is
 * invisible until someone drags the next item and gets a constraint violation
 * from an unrelated row. Failing on the request that is actually wrong is the
 * kinder error.
 *
 * Returns the items sorted by position, which is the order the caller must
 * write them in.
 */
export function normalizeReorderItems(
  items: ReorderItem[],
  existingIds: string[],
  subject: string,
): ReorderItem[] {
  const seenIds = new Set<string>();
  for (const item of items) {
    if (seenIds.has(item.id)) {
      throw new BadRequestException(
        `${subject} reorder payload contains duplicate ids.`,
      );
    }
    seenIds.add(item.id);
  }

  if (items.length !== existingIds.length) {
    throw new BadRequestException(
      `${subject} reorder payload must include all items in the container.`,
    );
  }

  const existingIdSet = new Set(existingIds);
  for (const item of items) {
    if (!existingIdSet.has(item.id)) {
      throw new BadRequestException(
        `${subject} reorder payload contains ids outside the container.`,
      );
    }
  }

  const sorted = [...items].sort((a, b) => a.position - b.position);
  sorted.forEach((item, index) => {
    if (item.position !== index) {
      throw new BadRequestException(
        `${subject} reorder positions must be contiguous and start at 0.`,
      );
    }
  });

  return sorted;
}

/**
 * The parking band a two-pass reorder writes into before writing final
 * positions.
 *
 * supabase-js issues one statement per request, so a reorder cannot run in a
 * transaction and cannot swap two positions directly — the intermediate state
 * would violate the UNIQUE index. Every row therefore moves somewhere no row
 * can currently be, and then moves back. `+ count + 1000` clears both the
 * current maximum and the number of rows about to be parked.
 */
export function reorderTempBase(
  positions: number[],
  itemCount: number,
): number {
  const maxPosition = positions.reduce(
    (max, position) =>
      Math.max(max, typeof position === 'number' ? position : 0),
    0,
  );
  return maxPosition + itemCount + 1000;
}
