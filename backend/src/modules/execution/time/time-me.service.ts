// `GET /time/me/projects` (A9): the projects the caller can log time on, for the Start timer and Add time
// pickers (ux.md "Picker order": only projects where the caller has `time.log` and at least one option).
//
// One batched pass narrows the caller's projects to those whose share rows grant `time.log` (or that they own
// with no share row, as the resolver does), then the For resolver answers each one with `purpose: 'read'`, so
// the picker and `GET …/logging-for` can never disagree. The whole answer is cached per user for 30 s under the
// For-resolver epoch (time-cache.ts): a policy write, a team toggle, an assignment change or a changed
// remembered default bumps the epoch and the next read recomputes.
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import type { Redis } from '@upstash/redis';
import { UPSTASH_REDIS_CLIENT } from '../../../config/redis.tokens';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  getPermission,
  type ProjectRole,
  resolvePermissions,
  ROLE_DEFAULTS,
} from '../projects/permissions/project-permissions';
import { LoggingContextService } from './logging-context.service';
import { LF_EPOCH_KEY, LF_TTL_SECONDS } from './time-cache';
import { mapTimeDbError, type PgErrorLike } from './time-errors';
import type {
  LoggableProject,
  LoggingForResult,
  MyProjectsResult,
} from './time.types';

/** At most this many projects are resolved and listed (the most recently logged ones). */
export const MY_PROJECTS_MAX = 200;
/** Resolver calls in flight at once. */
const RESOLVE_CONCURRENCY = 8;
/** PostgREST answers at most max-rows (1000) per request, so the share reads page. */
const PAGE = 1000;
/** A person on more than PAGE × MAX_PAGES projects is listed from the first ones read. */
const MAX_PAGES = 5;
/** `.in()` lists are chunked so a long list never builds an over-long URL. */
const IN_CHUNK = 100;
/** The newest entries scanned for "last logged" (ordering only). */
const RECENT_ENTRIES = 1000;

const READ_FAILED_MESSAGE = "Proyekto couldn't load your projects. Try again.";

/** The cache key of one user's answer under one For-resolver epoch. */
export function myProjectsKey(epoch: string, userId: string): string {
  return `time:mp:${epoch}:${userId}`;
}

interface ProjectRow {
  id: string;
  title: string | null;
  workspace_id: string | null;
  status: string | null;
}

interface ShareRow {
  project_id: string | null;
  role: ProjectRole;
  capabilities: Record<string, unknown> | null;
}

/** A resolve that failed for a reason other than "not found" (the project or the access is gone). */
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

function timeOf(iso: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** Most recently logged first, then never-logged projects by title, then id (stable). */
function byRecencyThenTitle(
  a: { row: ProjectRow; last: string | null },
  b: { row: ProjectRow; last: string | null },
): number {
  const recency = timeOf(b.last) - timeOf(a.last);
  if (recency !== 0 && !Number.isNaN(recency)) return recency;
  const title = (a.row.title ?? '').localeCompare(b.row.title ?? '', 'en', {
    sensitivity: 'base',
  });
  if (title !== 0) return title;
  return a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0;
}

function decode(value: unknown): MyProjectsResult | null {
  if (value === null || value === undefined) return null;
  // @upstash/redis deserialises JSON on read; a raw string is decoded here.
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const projects = (parsed as { projects?: unknown }).projects;
  return Array.isArray(projects) ? (parsed as MyProjectsResult) : null;
}

@Injectable()
export class TimeMeService {
  private readonly logger = new Logger(TimeMeService.name);
  private lastCacheWarnAt = 0;

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly loggingContext: LoggingContextService,
    // Null without Upstash credentials: every read computes.
    @Optional()
    @Inject(UPSTASH_REDIS_CLIENT)
    private readonly redis: Redis | null = null,
  ) {}

  /**
   * A9. The caller's projects with `time.log` and at least one For option, most recently logged first, at most
   * MY_PROJECTS_MAX. Each item carries the option count and the kind a new entry would use without asking.
   * Cached 30 s per user under the For-resolver epoch (read before the compute, D56); a partial answer (a
   * project whose resolve failed) is returned but never cached.
   */
  async projects(userId: string): Promise<MyProjectsResult> {
    const epoch = await this.readEpoch();
    if (epoch !== null) {
      const hit = await this.readCached(epoch, userId);
      if (hit) return hit;
    }
    const { result, complete } = await this.compute(userId);
    if (complete && epoch !== null) {
      await this.writeCached(epoch, userId, result);
    }
    return result;
  }

  // ── compute ───────────────────────────────────────────────────────────────

  private async compute(
    userId: string,
  ): Promise<{ result: MyProjectsResult; complete: boolean }> {
    const ids = await this.loggableProjectIds(userId);
    if (ids.length === 0) return { result: { projects: [] }, complete: true };

    const [rows, recent] = await Promise.all([
      this.loadProjects(ids),
      this.lastLogged(userId),
    ]);
    const ordered = rows
      .map((row) => ({ row, last: recent.last.get(row.id) ?? null }))
      .sort(byRecencyThenTitle);
    const truncated = ordered.length > MY_PROJECTS_MAX;
    const listed = ordered.slice(0, MY_PROJECTS_MAX);

    const at = new Date();
    const resolved = await mapLimit(listed, RESOLVE_CONCURRENCY, (p) =>
      this.resolveOne(userId, p.row.id, at),
    );
    const failures = resolved.filter((r) => r === FAILED).length;
    if (failures > 0 && failures === listed.length) {
      // Nothing could be answered: an error, not an empty picker.
      throw new InternalServerErrorException({
        code: 'TIME_INTERNAL',
        message: READ_FAILED_MESSAGE,
      });
    }

    const projects: LoggableProject[] = [];
    listed.forEach(({ row, last }, i) => {
      const r = resolved[i];
      if (r === FAILED || r === null || r.options.length === 0) return;
      const pick = r.selected ?? r.prefill;
      projects.push({
        id: row.id,
        title: row.title ?? 'Untitled project',
        workspace_id: row.workspace_id ?? null,
        options: r.options.length,
        default_kind: pick?.kind ?? null,
        status: row.status ?? null,
        last_logged_at: last,
      });
    });

    const result: MyProjectsResult = truncated
      ? { projects, truncated: true }
      : { projects };
    return { result, complete: failures === 0 && recent.complete };
  }

  /** null = the resolver says the project or the access is gone (404): simply not listed. */
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
        `time_me_projects_resolve_failed project=${projectId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return FAILED;
    }
  }

  /**
   * Projects whose share rows grant `time.log` (any row, as the OR-union of rows does), plus owned projects with
   * no share row (the resolver then uses the owner defaults). The resolver re-checks each one.
   */
  private async loggableProjectIds(userId: string): Promise<string[]> {
    const [shares, owned] = await Promise.all([
      this.paged<ShareRow>('shares', (from, to) =>
        this.sb
          .from('project_access')
          .select('project_id, role, capabilities')
          .eq('user_id', userId)
          .order('project_id', { ascending: true })
          .range(from, to),
      ),
      this.paged<{ id: string }>('owned', (from, to) =>
        this.sb
          .from('projects')
          .select('id')
          .eq('owner_id', userId)
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ]);

    const withRows = new Set<string>();
    const logs = new Set<string>();
    for (const row of shares) {
      if (!row.project_id) continue;
      withRows.add(row.project_id);
      if (!Object.hasOwn(ROLE_DEFAULTS, row.role)) continue;
      const perms = resolvePermissions(row.role, row.capabilities ?? null);
      if (getPermission(perms, 'time.log')) logs.add(row.project_id);
    }
    if (getPermission(ROLE_DEFAULTS.owner, 'time.log')) {
      for (const { id } of owned) {
        if (id && !withRows.has(id)) logs.add(id);
      }
    }
    return [...logs];
  }

  private async loadProjects(ids: string[]): Promise<ProjectRow[]> {
    const parts = await Promise.all(
      chunks(ids).map(async (part) => {
        const { data, error } = await this.sb
          .from('projects')
          .select('id, title, workspace_id, status')
          .in('id', part);
        if (error) this.fail('projects', error);
        return (data ?? []) as ProjectRow[];
      }),
    );
    return parts.flat();
  }

  /**
   * project id → `started_at` of the caller's newest entry there, from their latest RECENT_ENTRIES entries.
   * Ordering only, so a failed read degrades to "never logged" (and the answer is not cached).
   */
  private async lastLogged(
    userId: string,
  ): Promise<{ last: Map<string, string>; complete: boolean }> {
    const last = new Map<string, string>();
    const { data, error } = await this.sb
      .from('time_entries')
      .select('project_id, started_at')
      .eq('member_user_id', userId)
      .not('project_id', 'is', null)
      .order('started_at', { ascending: false })
      .limit(RECENT_ENTRIES);
    if (error) {
      this.logger.warn(
        `time_me_projects_recent_failed code=${error.code ?? 'none'} message=${error.message ?? ''}`,
      );
      return { last, complete: false };
    }
    for (const row of (data ?? []) as Array<{
      project_id: string | null;
      started_at: string | null;
    }>) {
      if (row.project_id && row.started_at && !last.has(row.project_id)) {
        last.set(row.project_id, row.started_at);
      }
    }
    return { last, complete: true };
  }

  private async paged<T>(
    op: string,
    page: (
      from: number,
      to: number,
    ) => PromiseLike<{ data: unknown; error: PgErrorLike | null }>,
  ): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < MAX_PAGES; i++) {
      const { data, error } = await page(i * PAGE, (i + 1) * PAGE - 1);
      if (error) this.fail(op, error);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }

  // ── cache (never throws) ──────────────────────────────────────────────────

  /** The For-resolver epoch, read once before the compute (D56); null = no Redis or a Redis error (no cache). */
  private async readEpoch(): Promise<string | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get<string | number>(LF_EPOCH_KEY);
      return raw === null || raw === undefined ? '0' : String(raw);
    } catch (error) {
      this.warnCache('epoch', error);
      return null;
    }
  }

  private async readCached(
    epoch: string,
    userId: string,
  ): Promise<MyProjectsResult | null> {
    if (!this.redis) return null;
    try {
      return decode(await this.redis.get(myProjectsKey(epoch, userId)));
    } catch (error) {
      this.warnCache('read', error);
      return null;
    }
  }

  /** Under the epoch read before the compute: a bump meanwhile strands this answer under the old epoch. */
  private async writeCached(
    epoch: string,
    userId: string,
    value: MyProjectsResult,
  ): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(
        myProjectsKey(epoch, userId),
        JSON.stringify(value),
        {
          ex: LF_TTL_SECONDS,
        },
      );
    } catch (error) {
      this.warnCache('write', error);
    }
  }

  /** Redis failures are logged at warn, at most once a minute per process. */
  private warnCache(op: string, error: unknown): void {
    const now = Date.now();
    if (now - this.lastCacheWarnAt < 60_000) return;
    this.lastCacheWarnAt = now;
    this.logger.warn(
      `time_me_projects_cache_${op}_failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  /** A time sentinel maps as usual; anything else is a logged 500 with fixed copy (D55, D68). */
  private fail(op: string, error: PgErrorLike): never {
    const mapped = mapTimeDbError(error);
    if (mapped) throw mapped;
    this.logger.error(
      `time_me_projects_${op}_failed code=${error.code ?? 'none'} message=${error.message ?? ''}`,
    );
    throw new InternalServerErrorException({
      code: 'TIME_INTERNAL',
      message: READ_FAILED_MESSAGE,
    });
  }
}
