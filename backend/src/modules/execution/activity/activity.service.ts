import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import { getPermission } from '../projects/permissions/project-permissions';
import {
  ACTIVITY_ACTIONS,
  actionFamily,
} from '../../shared/audit/activity-actions';
import {
  ACTIVITY_DEFAULT_LIMIT,
  ACTIVITY_MAX_LIMIT,
  decodeActivityCursor,
  encodeActivityCursor,
  type ActivityEntryDto,
  type ActivityRetention,
  type ListProjectActivityQueryDto,
  type ListProjectActivityResult,
} from './dto/activity.dto';

const ACTIVITY_TABLE = 'project_activity_log';

const ACTIVITY_SELECT =
  'id, seq, project_id, roadmap_id, actor_id, action, entity_type, entity_id, ' +
  'is_sensitive, metadata, created_at, ' +
  'actor:profiles!project_activity_log_actor_id_fkey(id, display_name, avatar_url)';

/** All declared actions in a family, e.g. 'task' -> ['task.created', ...]. */
function actionsInFamily(family: string): string[] {
  return Object.values(ACTIVITY_ACTIONS).filter(
    (action) => actionFamily(action) === family,
  );
}

/**
 * Reader for the project activity log. The counterpart to AuditService, which
 * is now a pure writer.
 *
 * ORDERING: (created_at DESC, seq DESC), paged with a keyset on the same pair.
 * created_at is stamped at event time by AuditService, so it is the truth
 * about when something happened; seq only records when the database heard
 * about it, which the bounded flush can reorder. seq stays in the key because
 * created_at is millisecond resolution and several events per request share a
 * millisecond — seq is UNIQUE, so the pair is a strict total order and paging
 * can neither skip nor duplicate a row.
 *
 * RETENTION: the workspace plan's activity_retention_days hides older rows by
 * raising the lower bound, never by deleting anything; an upgrade shows them
 * again. The window is reported back as `retention` so the page can say why
 * the feed stops.
 */
@Injectable()
export class ActivityService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly authorization: ProjectAuthorizationService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(
    projectId: string,
    userId: string,
    q: ListProjectActivityQueryDto,
  ): Promise<ListProjectActivityResult> {
    // Returns the resolved permission set, so the sensitivity check below
    // costs zero extra queries. The retention window is looked up alongside
    // it rather than after: it cannot throw (it fails open to unlimited) and
    // reveals nothing unless the permission check passes.
    const [perms, retention] = await Promise.all([
      this.authorization.assertPermission(userId, projectId, 'logs.view'),
      this.retentionWindow(projectId),
    ]);
    const canViewSensitive = getPermission(perms, 'logs.view_sensitive');

    const limit = Math.min(
      Math.max(q.limit ?? ACTIVITY_DEFAULT_LIMIT, 1),
      ACTIVITY_MAX_LIMIT,
    );
    const cursor = decodeActivityCursor(q.cursor);

    // The caller's `to` bound and the cursor both cap created_at. Fold them
    // into ONE .lte rather than emitting two overlapping filters.
    const upperBounds = [cursor?.createdAt, q.to].filter(
      (value): value is string => typeof value === 'string',
    );
    const upper = upperBounds.length
      ? upperBounds.reduce((a, b) => (a < b ? a : b))
      : null;

    // Everything asked for is older than the plan shows: answer empty without
    // a query rather than letting the bounds cross.
    if (upper && retention.cutoff && isBefore(upper, retention.cutoff)) {
      return {
        items: [],
        next_cursor: null,
        can_view_sensitive: canViewSensitive,
        retention,
      };
    }
    // The plan's window only ever narrows the caller's `from`, never widens it.
    const lower =
      retention.cutoff && (!q.from || isBefore(q.from, retention.cutoff))
        ? retention.cutoff
        : (q.from ?? null);

    let query = this.db
      .from(ACTIVITY_TABLE)
      .select(ACTIVITY_SELECT)
      .eq('project_id', projectId);

    if (!canViewSensitive) query = query.eq('is_sensitive', false);
    if (q.roadmap_id) query = query.eq('roadmap_id', q.roadmap_id);
    if (q.entity_type) query = query.eq('entity_type', q.entity_type);
    if (q.entity_id) query = query.eq('entity_id', q.entity_id);

    // Multi-value filters are OR within themselves, AND across each other —
    // the semantics a checkbox sidebar implies.
    if (q.actor_id?.length) query = query.in('actor_id', q.actor_id);

    // Exact action wins over family. `.in` over `.like('action','task.%')`:
    // exact, and no wildcard-escaping question.
    if (q.action) {
      query = query.eq('action', q.action);
    } else if (q.family?.length) {
      query = query.in(
        'action',
        q.family.flatMap((family) => actionsInFamily(family)),
      );
    }

    if (lower) query = query.gte('created_at', lower);

    // THIS .lte IS LOAD-BEARING, not a duplicate of the .or below.
    // supabase-js has no row-value operator, and the OR form alone degrades to
    // a Filter over the whole project range — O(scroll depth). Verified with
    // EXPLAIN on idx_project_activity_log_project_occurred_desc: with the .lte
    // the plan is `Index Cond: (project_id = .. AND created_at <= ..)` and no
    // Sort node; without it Index Cond collapses to project_id alone.
    if (upper) query = query.lte('created_at', upper);

    if (cursor) {
      // Only breaks the tie inside the cursor's exact millisecond, so the
      // Filter it produces is bounded by events-per-request, never by depth.
      // `createdAt` is safe to interpolate: decodeActivityCursor round-trips
      // it through Date, so nothing that is not a real timestamp gets here.
      const iso = cursor.createdAt;
      query = query.or(
        `created_at.lt."${iso}",and(created_at.eq."${iso}",seq.lt.${cursor.seq})`,
      );
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('seq', { ascending: false })
      .limit(limit + 1); // +1 probes for a next page without a count query

    if (error) throw new InternalServerErrorException(error.message);

    const rows = (data ?? []) as unknown as ActivityEntryDto[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];

    return {
      items,
      next_cursor: hasMore && last ? encodeActivityCursor(last) : null,
      can_view_sensitive: canViewSensitive,
      retention,
    };
  }

  /** The project's workspace plan decides; unlimited is `{ days: null, cutoff: null }`. */
  private async retentionWindow(projectId: string): Promise<ActivityRetention> {
    const scope = await this.entitlements.resolveScopeForProject(projectId);
    return this.entitlements.getRetentionCutoff(scope);
  }
}

/**
 * Timestamp order, not string order: `from`/`to` are any ISO-8601 the DTO
 * accepts (a bare date, an offset), while the cutoff is a UTC toISOString.
 */
function isBefore(value: string, cutoff: string): boolean {
  return new Date(value).getTime() < new Date(cutoff).getTime();
}
