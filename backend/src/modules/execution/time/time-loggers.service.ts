// `GET /time/projects/:projectId/loggers` (A11): Project settings › Time "Who can log time here". Everyone with
// `time.log` on the project, each with the option their time goes to by default, so a manager can see why a
// person logs for a team, the workspace, an agreement or just themselves (ux.md "Project settings › Time").
//
// Project admins and owners only (the share ladder, or `projects.owner_id`); anyone else gets 404, the same miss
// as a project that does not exist. Placed talent follows the roster rule (L22, D57): a worker the viewer may not
// name is masked like on the project roster, and their agreement row is not listed at all, because "agreement
// with Pixel Studio" would say what the mask hides.
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  getPermission,
  type ProjectRole,
  resolvePermissions,
  ROLE_DEFAULTS,
} from '../projects/permissions/project-permissions';
import { LoggingContextService } from './logging-context.service';
import { TimeAuthorityService } from './time-authority.service';
import { mapTimeDbError, type PgErrorLike, timeNotFound } from './time-errors';
import { ROSTER_MASKED_LABEL } from './time-projects.facade';
import type {
  LoggingForResult,
  LoggingOption,
  ProjectLogger,
  ProjectLoggerReason,
  ProjectLoggersResult,
} from './time.types';

/** At most this many people are resolved and listed. */
export const LOGGERS_MAX = 200;
/** "just you": the personal option as the settings list says it ("You (editor · just you)"). */
export const LOGGER_PERSONAL_LABEL = 'just you';
/** Resolver calls in flight at once. */
const RESOLVE_CONCURRENCY = 8;
/** PostgREST answers at most max-rows (1000) per request, so the share read pages. */
const PAGE = 1000;
const MAX_PAGES = 5;
const IN_CHUNK = 100;
/** Postgres `invalid_text_representation`: a non-UUID id reached a uuid column. */
const INVALID_TEXT_REPRESENTATION = '22P02';

const READ_FAILED_MESSAGE =
  "Proyekto couldn't load who can log time here. Try again.";

const ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  commenter: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

interface ProjectRow {
  id: string;
  owner_id: string | null;
}

interface AccessRow {
  id: string;
  user_id: string | null;
  role: ProjectRole;
  capabilities: Record<string, unknown> | null;
}

interface Holder {
  userId: string;
  /** The person's project_access row (the mask token), null for an owner with no share row. */
  rowId: string | null;
  role: ProjectRole;
}

/** A resolve that failed for a reason other than "not found". */
const FAILED = Symbol('failed');

/** At most `limit` calls in flight; results in input order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += IN_CHUNK) {
    out.push(items.slice(i, i + IN_CHUNK));
  }
  return out;
}

function isRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && Object.hasOwn(ROLE_DEFAULTS, value);
}

/** Pure: a person's primary option as the settings list phrases it. */
export function loggerLabel(option: LoggingOption): {
  reason: ProjectLoggerReason;
  label: string;
} {
  switch (option.kind) {
    case 'team':
      return { reason: 'team', label: option.label };
    case 'workspace':
      return { reason: 'workspace', label: option.label };
    case 'assignment':
      return { reason: 'agreement', label: `agreement with ${option.label}` };
    default:
      return { reason: 'personal', label: LOGGER_PERSONAL_LABEL };
  }
}

/** Named people by name (unnamed last), masked people last, then by id: a stable order that ranks nobody. */
function byName(a: ProjectLogger, b: ProjectLogger): number {
  const maskedA = a.user_id.startsWith('masked:');
  const maskedB = b.user_id.startsWith('masked:');
  if (maskedA !== maskedB) return maskedA ? 1 : -1;
  const namedA = Boolean(a.display_name);
  const namedB = Boolean(b.display_name);
  if (namedA !== namedB) return namedA ? -1 : 1;
  const name = (a.display_name ?? '').localeCompare(
    b.display_name ?? '',
    'en',
    {
      sensitivity: 'base',
    },
  );
  if (name !== 0) return name;
  return a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0;
}

@Injectable()
export class TimeLoggersService {
  private readonly logger = new Logger(TimeLoggersService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly loggingContext: LoggingContextService,
    private readonly authority: TimeAuthorityService,
  ) {}

  /**
   * A11. Everyone who holds `time.log` on the project (any share row grants it, or they own the project with no
   * share row), with their primary option: the resolver's selected option, else the remembered prefill, else
   * the first. Deleted accounts are left out. 404 unless the viewer is a project admin or owner.
   */
  async forProject(
    viewerId: string,
    projectId: string,
  ): Promise<ProjectLoggersResult> {
    const project = await this.loadProject(projectId);
    if (!project) throw timeNotFound('scope');
    const rows = await this.accessRows(projectId);
    if (!this.isManager(viewerId, project, rows)) throw timeNotFound('scope');

    const holders = this.holders(project, rows);
    if (holders.length === 0) return { people: [] };

    const [names, masked] = await Promise.all([
      this.liveNames(holders.map((h) => h.userId)),
      this.authority.maskedWorkerIds(projectId, viewerId),
    ]);
    // Deleted accounts (and ids with no profile) cannot log.
    const live = holders
      .filter((h) => names.has(h.userId))
      .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
    const truncated = live.length > LOGGERS_MAX;
    const listed = live.slice(0, LOGGERS_MAX);

    const at = new Date();
    const resolved = await mapLimit(listed, RESOLVE_CONCURRENCY, (h) =>
      this.resolveOne(h.userId, projectId, at),
    );
    const failures = resolved.filter((r) => r === FAILED).length;
    if (failures > 0 && failures === listed.length) {
      throw new InternalServerErrorException({
        code: 'TIME_INTERNAL',
        message: READ_FAILED_MESSAGE,
      });
    }

    const people: ProjectLogger[] = [];
    listed.forEach((h, i) => {
      const r = resolved[i];
      if (r === null) return; // gone from the project meanwhile
      const isMasked = masked.has(h.userId);
      if (r === FAILED) {
        // A masked person may be placed talent: list them only when we know they are not (L22).
        if (isMasked) return;
        people.push({
          user_id: h.userId,
          display_name: names.get(h.userId) ?? null,
          role: h.role,
          reason: 'none',
          label: '',
          options: 0,
        });
        return;
      }
      if (r.options.length === 0) return; // lost time.log meanwhile
      const primary = r.selected ?? r.prefill ?? r.options[0];
      // L22: talent rows are listed only for provider-side viewers. maskedWorkerIds holds exactly the placed
      // talent the viewer may not name, so an agreement row of a masked person is a talent row.
      if (isMasked && primary.kind === 'assignment') return;
      const { reason, label } = loggerLabel(primary);
      people.push({
        user_id: isMasked
          ? `masked:${h.rowId ?? `${projectId}:${i}`}`
          : h.userId,
        display_name: isMasked
          ? ROSTER_MASKED_LABEL
          : (names.get(h.userId) ?? null),
        role: h.role,
        reason,
        label,
        options: r.options.length,
      });
    });

    people.sort(byName);
    return truncated ? { people, truncated: true } : { people };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Project admins and owners (the strongest of their share rows), or `projects.owner_id`. */
  private isManager(
    viewerId: string,
    project: ProjectRow,
    rows: AccessRow[],
  ): boolean {
    if (project.owner_id !== null && project.owner_id === viewerId) return true;
    return rows.some(
      (r) =>
        r.user_id === viewerId &&
        isRole(r.role) &&
        ROLE_RANK[r.role] >= ROLE_RANK.admin,
    );
  }

  /** People whose share rows grant `time.log` (any row: the OR-union), and the owner with no share row. */
  private holders(project: ProjectRow, rows: AccessRow[]): Holder[] {
    const byUser = new Map<string, Holder & { logs: boolean }>();
    for (const row of rows) {
      if (!row.user_id || !isRole(row.role)) continue;
      const logs = getPermission(
        resolvePermissions(row.role, row.capabilities ?? null),
        'time.log',
      );
      const current = byUser.get(row.user_id);
      if (!current) {
        byUser.set(row.user_id, {
          userId: row.user_id,
          rowId: row.id,
          role: row.role,
          logs,
        });
        continue;
      }
      if (ROLE_RANK[row.role] > ROLE_RANK[current.role]) {
        current.role = row.role;
      }
      current.logs = current.logs || logs;
    }
    if (project.owner_id && !byUser.has(project.owner_id)) {
      byUser.set(project.owner_id, {
        userId: project.owner_id,
        rowId: null,
        role: 'owner',
        logs: getPermission(ROLE_DEFAULTS.owner, 'time.log'),
      });
    }
    return [...byUser.values()]
      .filter((h) => h.logs)
      .map(({ userId, rowId, role }) => ({ userId, rowId, role }));
  }

  /** null = the resolver says the project or the person's access is gone (404). */
  private async resolveOne(
    userId: string,
    projectId: string,
    at: Date,
  ): Promise<LoggingForResult | null | typeof FAILED> {
    try {
      return await this.loggingContext.resolve(userId, projectId, {
        at,
        purpose: 'read',
      });
    } catch (error) {
      if (
        error instanceof HttpException &&
        error.getStatus() === (HttpStatus.NOT_FOUND as number)
      ) {
        return null;
      }
      this.logger.warn(
        `time_loggers_resolve_failed project=${projectId} user=${userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return FAILED;
    }
  }

  private async loadProject(projectId: string): Promise<ProjectRow | null> {
    const { data, error } = await this.sb
      .from('projects')
      .select('id, owner_id')
      .eq('id', projectId)
      .maybeSingle();
    if (error) {
      if (error.code === INVALID_TEXT_REPRESENTATION) return null;
      this.fail('project', error);
    }
    return (data as ProjectRow | null) ?? null;
  }

  private async accessRows(projectId: string): Promise<AccessRow[]> {
    const out: AccessRow[] = [];
    for (let i = 0; i < MAX_PAGES; i++) {
      const { data, error } = await this.sb
        .from('project_access')
        .select('id, user_id, role, capabilities')
        .eq('project_id', projectId)
        .order('id', { ascending: true })
        .range(i * PAGE, (i + 1) * PAGE - 1);
      if (error) this.fail('access', error);
      const rows = (data ?? []) as AccessRow[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }

  /** id → display_name for live accounts (`deleted_at IS NULL`); a deleted or missing profile is absent. */
  private async liveNames(ids: string[]): Promise<Map<string, string | null>> {
    const names = new Map<string, string | null>();
    for (const part of chunks(ids)) {
      const { data, error } = await this.sb
        .from('profiles')
        .select('id, display_name')
        .in('id', part)
        .is('deleted_at', null);
      if (error) this.fail('profiles', error);
      for (const row of (data ?? []) as Array<{
        id: string;
        display_name: string | null;
      }>) {
        names.set(row.id, row.display_name ?? null);
      }
    }
    return names;
  }

  /** A time sentinel maps as usual; anything else is a logged 500 with fixed copy (D55, D68). */
  private fail(op: string, error: PgErrorLike): never {
    const mapped = mapTimeDbError(error);
    if (mapped) throw mapped;
    this.logger.error(
      `time_loggers_${op}_failed code=${error.code ?? 'none'} message=${error.message ?? ''}`,
    );
    throw new InternalServerErrorException({
      code: 'TIME_INTERNAL',
      message: READ_FAILED_MESSAGE,
    });
  }
}
