import { BadRequestException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ACTION_FAMILIES,
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
} from '../../audit/activity-actions';

export const ACTIVITY_DEFAULT_LIMIT = 50;
export const ACTIVITY_MAX_LIMIT = 100;

/**
 * Normalise a repeatable query param to an array.
 *
 * Express/qs yields a string for `?family=task` and an array for
 * `?family=task&family=epic`; without this the single-value case would fail
 * `@IsArray` and 400 a perfectly reasonable request.
 */
function toStringArray({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null) return value;
  return Array.isArray(value) ? value : [value];
}

/**
 * Query for GET /projects/:projectId/activity.
 *
 * NOTE THE ABSENCE OF `offset`. The global ValidationPipe runs
 * whitelist + forbidNonWhitelisted, so a client still sending `?offset=0`
 * gets a 400 rather than silently falling back to offset paging against a
 * cursor-paginated endpoint. That loud failure is deliberate and tested.
 */
export class ListProjectActivityQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ACTIVITY_MAX_LIMIT)
  limit?: number;

  /** Opaque base64url keyset cursor. See decodeActivityCursor. */
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;

  /**
   * Action families, e.g. ['task','epic'] — ignored when `action` is given.
   *
   * Accepts one value or many: the Logs sidebar filters with checkboxes, so
   * `?family=task&family=epic` must mean OR, not "last one wins". A bare
   * `?family=task` still works for a single-value caller.
   */
  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsIn(ACTION_FAMILIES as unknown as string[], { each: true })
  family?: string[];

  /** Exact action. Wins over `family`. */
  @IsOptional()
  @IsIn(Object.values(ACTIVITY_ACTIONS) as string[])
  action?: string;

  @IsOptional()
  @IsIn(ACTIVITY_ENTITY_TYPES as unknown as string[])
  entity_type?: string;

  /** One or many actors, same OR semantics as `family`. */
  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsUUID('all', { each: true })
  actor_id?: string[];

  @IsOptional() @IsUUID() roadmap_id?: string;
  @IsOptional() @IsUUID() entity_id?: string;

  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

export interface ActivityActorDto {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface ActivityEntryDto {
  id: string;
  seq: number;
  project_id: string;
  roadmap_id: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  is_sensitive: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  actor: ActivityActorDto | null;
}

export interface ListProjectActivityResult {
  items: ActivityEntryDto[];
  next_cursor: string | null;
  /**
   * False when the reader lacks `logs.view_sensitive` and sensitive rows were
   * filtered server-side. Surfaced so the UI can say "some entries are
   * hidden" — on an audit surface, honest omission beats silent omission.
   */
  can_view_sensitive: boolean;
}

export interface ActivityCursor {
  createdAt: string;
  seq: number;
}

/**
 * Encode the keyset cursor.
 *
 * Postgres returns timestamps as '2026-08-01 13:45:54.004646+00' (space
 * separator, microseconds). Normalising through Date#toISOString truncates to
 * milliseconds — which is safe ONLY because `seq` is also in the key and
 * breaks any tie the truncation creates. Do not drop seq from the cursor.
 */
export function encodeActivityCursor(row: {
  created_at: string;
  seq: number;
}): string {
  const iso = new Date(row.created_at).toISOString();
  return Buffer.from(JSON.stringify({ c: iso, s: row.seq }), 'utf8').toString(
    'base64url',
  );
}

/**
 * Decode and VALIDATE the keyset cursor.
 *
 * This is a security boundary, not just parsing. The cursor value is
 * interpolated into a raw PostgREST filter string via `.or()`, so an
 * unvalidated cursor is a filter-injection vector — a crafted value such as
 *   {"c":"2026-01-01T00:00:00.000Z\",seq.gt.0,or(is_sensitive.eq.true","s":1}
 * would otherwise smuggle a clause that reveals sensitive rows the caller is
 * not entitled to see.
 *
 * The round-trip check is the guard: only a value that Date can regenerate
 * byte-for-byte reaches the filter string, which rejects every injection
 * shape because none of them survive re-serialisation.
 */
export function decodeActivityCursor(
  raw?: string | null,
): ActivityCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );
    const candidate = parsed as { c?: unknown; s?: unknown } | null;
    if (!candidate || typeof candidate.c !== 'string') throw new Error('shape');
    if (typeof candidate.s !== 'number') throw new Error('shape');
    if (!Number.isSafeInteger(candidate.s) || candidate.s < 0) {
      throw new Error('seq');
    }
    const iso = new Date(candidate.c).toISOString();
    if (iso !== candidate.c) throw new Error('timestamp');
    return { createdAt: iso, seq: candidate.s };
  } catch {
    throw new BadRequestException('Invalid pagination cursor');
  }
}
