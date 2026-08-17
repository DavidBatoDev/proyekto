import { BadRequestException } from '@nestjs/common';
import type { LinkTargetDto } from './dto/delivery.dto';

/**
 * The link junctions (`deliverable_links`, `change_request_links`,
 * `risk_links`) each carry several nullable FK columns with a
 * `num_nonnulls(...) = 1` CHECK, rather than a polymorphic
 * (target_type, target_id) pair — that keeps ON DELETE CASCADE and referential
 * integrity working.
 *
 * The database will reject a malformed row either way; validating here is what
 * turns that into a 400 the caller can act on instead of a 500.
 */
export function normalizeLinkTargets(
  links: LinkTargetDto[] | undefined,
  allowed: readonly (keyof LinkTargetDto)[],
): Array<Partial<Record<keyof LinkTargetDto, string>>> {
  if (!links?.length) return [];

  return links.map((link, index) => {
    const set = allowed.filter((column) => Boolean(link[column]));

    if (set.length === 0) {
      throw new BadRequestException(
        `links[${index}] must target exactly one of: ${allowed.join(', ')}`,
      );
    }
    if (set.length > 1) {
      throw new BadRequestException(
        `links[${index}] targets more than one entity (${set.join(', ')}); exactly one is allowed`,
      );
    }

    // Reject columns this junction does not have, rather than silently
    // dropping them — a caller linking a milestone to a change request should
    // hear about it.
    const supplied = (Object.keys(link) as (keyof LinkTargetDto)[]).filter(
      (column) => Boolean(link[column]),
    );
    const unsupported = supplied.filter((column) => !allowed.includes(column));
    if (unsupported.length) {
      throw new BadRequestException(
        `links[${index}] cannot target ${unsupported.join(', ')} here`,
      );
    }

    return { [set[0]]: link[set[0]] as string };
  });
}
