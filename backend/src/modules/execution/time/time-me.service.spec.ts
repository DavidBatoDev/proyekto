import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UPSTASH_REDIS_CLIENT } from '../../../config/redis.tokens';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { TimeEntriesController } from './controllers/time-entries.controller';
import { LoggingContextService } from './logging-context.service';
import { LF_EPOCH_KEY, LF_TTL_SECONDS } from './time-cache';
import {
  MY_PROJECTS_MAX,
  myProjectsKey,
  TimeMeService,
} from './time-me.service';
import type {
  ContextKind,
  LoggingForResult,
  LoggingOption,
  MyProjectsResult,
} from './time.types';

// ── ids ─────────────────────────────────────────────────────────────────────
const uid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const ME = uid(1);
const OTHER = uid(2);
const P_EDITOR = uid(10);
const P_VIEWER = uid(11);
const P_OWNED = uid(12); // owned, no share row
const P_OWNED_VIEWER = uid(13); // owned, but the share row says viewer
const P_CAP = uid(14); // commenter granted time.log by a capability
const P_GONE = uid(15); // resolver 404s
const P_NONE = uid(16); // resolver answers no options
const WS = uid(20);

type Row = Record<string, unknown>;

// ── a tiny PostgREST stand-in that applies the filters it is given ─────────
interface Call {
  table: string;
  ops: Array<[string, ...unknown[]]>;
}

function fakeDb(
  tables: Record<string, Row[]>,
  errors: Record<string, { code?: string; message: string }> = {},
) {
  const calls: Call[] = [];
  const from = jest.fn((table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    let rows = [...(tables[table] ?? [])];
    let limit: number | null = null;
    let range: [number, number] | null = null;
    const builder: Record<string, unknown> = {};
    const chain =
      (name: string, apply?: (...args: unknown[]) => void) =>
      (...args: unknown[]) => {
        call.ops.push([name, ...args]);
        apply?.(...args);
        return builder;
      };
    builder.select = chain('select');
    builder.eq = chain('eq', (col, value) => {
      rows = rows.filter((r) => r[col as string] === value);
    });
    builder.in = chain('in', (col, values) => {
      const set = new Set(values as unknown[]);
      rows = rows.filter((r) => set.has(r[col as string]));
    });
    builder.is = chain('is', (col, value) => {
      rows = rows.filter((r) => (r[col as string] ?? null) === value);
    });
    builder.not = chain('not', (col, op, value) => {
      if (op === 'is' && value === null) {
        rows = rows.filter((r) => (r[col as string] ?? null) !== null);
      }
    });
    builder.order = chain('order', (col, o) => {
      const asc = (o as { ascending?: boolean } | undefined)?.ascending ?? true;
      rows.sort((a, b) => {
        const x = (a[col as string] as string | null) ?? '';
        const y = (b[col as string] as string | null) ?? '';
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
      });
    });
    builder.limit = chain('limit', (n) => {
      limit = n as number;
    });
    builder.range = chain('range', (a, b) => {
      range = [a as number, b as number];
    });
    const result = () => {
      const error = errors[table];
      if (error) return { data: null, error };
      let out = rows;
      if (range) out = out.slice(range[0], range[1] + 1);
      if (limit !== null) out = out.slice(0, limit);
      return { data: out, error: null };
    };
    builder.maybeSingle = () => {
      const r = result();
      return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error });
    };
    builder.then = (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result()).then(resolve, reject);
    return builder;
  });
  return { sb: { from }, calls, from };
}

/** An Upstash stand-in: get/set with JSON as @upstash/redis stores it. */
function fakeRedis(failing = false) {
  const store = new Map<string, unknown>();
  const ttl = new Map<string, number>();
  const down = () => Promise.reject(new Error('redis down'));
  return {
    store,
    ttl,
    get: jest.fn((key: string) =>
      failing
        ? down()
        : Promise.resolve(store.has(key) ? store.get(key) : null),
    ),
    set: jest.fn((key: string, value: unknown, o?: { ex?: number }) => {
      if (failing) return down();
      store.set(key, value);
      if (o?.ex) ttl.set(key, o.ex);
      return Promise.resolve('OK');
    }),
  };
}
type FakeRedis = ReturnType<typeof fakeRedis>;

// ── resolver results ────────────────────────────────────────────────────────
function option(kind: ContextKind, id: string | null = uid(90)): LoggingOption {
  return {
    kind,
    id: kind === 'personal' ? null : id,
    label: kind === 'personal' ? 'Just me' : `${kind} label`,
    sheet_scope:
      kind === 'personal' ? null : { kind: 'team', ref: id ?? uid(90) },
    rate_source: 'none',
    workspace_tag: null,
    approver_hint: null,
  };
}

function one(kind: ContextKind): LoggingForResult {
  const o = option(kind);
  return { options: [o], selected: o, prefill: null, unavailable: [] };
}

function several(prefillKind: ContextKind | null): LoggingForResult {
  const a = option('assignment', uid(91));
  const t = option('team', uid(92));
  const prefill = prefillKind === 'team' ? t : prefillKind ? a : null;
  return {
    options: [a, t],
    selected: null,
    prefill,
    reason: prefill ? 'confirm' : 'required',
    unavailable: [],
  };
}

const NONE: LoggingForResult = {
  options: [],
  selected: null,
  prefill: null,
  reason: 'none',
  unavailable: [],
};

function baseTables(): Record<string, Row[]> {
  return {
    project_access: [
      { project_id: P_EDITOR, user_id: ME, role: 'editor', capabilities: null },
      { project_id: P_VIEWER, user_id: ME, role: 'viewer', capabilities: null },
      {
        project_id: P_OWNED_VIEWER,
        user_id: ME,
        role: 'viewer',
        capabilities: null,
      },
      {
        project_id: P_CAP,
        user_id: ME,
        role: 'commenter',
        capabilities: { 'access.time': true, 'time.log': true },
      },
      { project_id: P_GONE, user_id: ME, role: 'editor', capabilities: null },
      { project_id: P_NONE, user_id: ME, role: 'admin', capabilities: null },
      // Someone else's rows never count.
      {
        project_id: P_VIEWER,
        user_id: OTHER,
        role: 'owner',
        capabilities: null,
      },
    ],
    projects: [
      {
        id: P_EDITOR,
        title: 'Website',
        workspace_id: WS,
        status: 'active',
        owner_id: OTHER,
      },
      {
        id: P_VIEWER,
        title: 'Viewer only',
        workspace_id: WS,
        status: 'active',
        owner_id: OTHER,
      },
      {
        id: P_OWNED,
        title: 'Mine',
        workspace_id: null,
        status: 'archived',
        owner_id: ME,
      },
      {
        id: P_OWNED_VIEWER,
        title: 'Owned viewer',
        workspace_id: WS,
        status: 'active',
        owner_id: ME,
      },
      {
        id: P_CAP,
        title: 'Capability',
        workspace_id: WS,
        status: 'active',
        owner_id: OTHER,
      },
      {
        id: P_GONE,
        title: 'Gone',
        workspace_id: WS,
        status: 'active',
        owner_id: OTHER,
      },
      {
        id: P_NONE,
        title: 'Nothing',
        workspace_id: WS,
        status: 'active',
        owner_id: OTHER,
      },
    ],
    time_entries: [
      {
        member_user_id: ME,
        project_id: P_CAP,
        started_at: '2026-10-01T09:00:00+00:00',
      },
      {
        member_user_id: ME,
        project_id: P_EDITOR,
        started_at: '2026-10-03T09:00:00+00:00',
      },
      {
        member_user_id: ME,
        project_id: P_EDITOR,
        started_at: '2026-09-01T09:00:00+00:00',
      },
      {
        member_user_id: ME,
        project_id: null,
        started_at: '2026-10-05T09:00:00+00:00',
      },
      // Someone else's newer entry never orders my list.
      {
        member_user_id: OTHER,
        project_id: P_OWNED,
        started_at: '2026-10-06T09:00:00+00:00',
      },
    ],
  };
}

function defaultResolver(projectId: string): Promise<LoggingForResult> {
  switch (projectId) {
    case P_EDITOR:
      return Promise.resolve(one('team'));
    case P_OWNED:
      return Promise.resolve(one('personal'));
    case P_CAP:
      return Promise.resolve(several('assignment'));
    case P_GONE:
      return Promise.reject(new NotFoundException({ code: 'TIME_NOT_FOUND' }));
    case P_NONE:
      return Promise.resolve(NONE);
    default:
      return Promise.resolve(several(null));
  }
}

async function setup(
  o: {
    tables?: Record<string, Row[]>;
    errors?: Record<string, { code?: string; message: string }>;
    redis?: FakeRedis | null;
    resolve?: (projectId: string) => Promise<LoggingForResult>;
  } = {},
) {
  const db = fakeDb(o.tables ?? baseTables(), o.errors);
  const resolve = jest.fn(
    (...args: [string, string, { at: Date; purpose: string }]) =>
      (o.resolve ?? defaultResolver)(args[1]),
  );
  const loggingContext = { resolve };
  const redis = o.redis === undefined ? fakeRedis() : o.redis;
  const moduleRef = await Test.createTestingModule({
    providers: [
      TimeMeService,
      { provide: SUPABASE_ADMIN, useValue: db.sb },
      { provide: LoggingContextService, useValue: loggingContext },
      ...(redis ? [{ provide: UPSTASH_REDIS_CLIENT, useValue: redis }] : []),
    ],
  }).compile();
  return { service: moduleRef.get(TimeMeService), db, resolve, redis };
}

let warn: jest.SpyInstance;
let error: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

describe('TimeMeService.projects (A9)', () => {
  it('lists the projects with time.log and at least one option, with the option count and default kind', async () => {
    const t = await setup();
    const result = await t.service.projects(ME);

    expect(result).toEqual({
      projects: [
        {
          id: P_EDITOR,
          title: 'Website',
          workspace_id: WS,
          workspace_name: null,
          options: 1,
          default_kind: 'team',
          status: 'active',
          last_logged_at: '2026-10-03T09:00:00+00:00',
        },
        {
          id: P_CAP,
          title: 'Capability',
          workspace_id: WS,
          workspace_name: null,
          options: 2,
          // Several options: the remembered prefill, one tap away.
          default_kind: 'assignment',
          status: 'active',
          last_logged_at: '2026-10-01T09:00:00+00:00',
        },
        {
          id: P_OWNED,
          title: 'Mine',
          workspace_id: null,
          workspace_name: null,
          options: 1,
          default_kind: 'personal',
          status: 'archived',
          last_logged_at: null,
        },
      ],
    });
  });

  it('labels each project with its workspace name, for projects shared from other workspaces', async () => {
    const t = await setup({
      tables: { ...baseTables(), workspaces: [{ id: WS, name: 'Acme Inc.' }] },
    });
    const result = await t.service.projects(ME);
    const byId = new Map(result.projects.map((p) => [p.id, p]));
    expect(byId.get(P_EDITOR)?.workspace_name).toBe('Acme Inc.');
    expect(byId.get(P_CAP)?.workspace_name).toBe('Acme Inc.');
    // No workspace, no name.
    expect(byId.get(P_OWNED)?.workspace_name).toBeNull();
  });

  it('still answers when the workspace name read fails, without names', async () => {
    const t = await setup({
      tables: { ...baseTables(), workspaces: [{ id: WS, name: 'Acme Inc.' }] },
      errors: { workspaces: { message: 'boom' } },
    });
    const result = await t.service.projects(ME);
    expect(result.projects).toHaveLength(3);
    expect(result.projects.every((p) => p.workspace_name === null)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('time_me_projects_workspace_names_failed'),
    );
  });

  it('never resolves a project the share rows say the caller cannot log on', async () => {
    const t = await setup();
    await t.service.projects(ME);
    const asked = t.resolve.mock.calls.map(([, projectId]) => projectId).sort();
    // Viewer rows (including on a project the caller owns) are filtered before the resolver.
    expect(asked).toEqual([P_EDITOR, P_OWNED, P_CAP, P_GONE, P_NONE].sort());
    for (const [user, , opts] of t.resolve.mock.calls) {
      expect(user).toBe(ME);
      expect(opts.purpose).toBe('read');
      expect(opts.at).toBeInstanceOf(Date);
    }
  });

  it('several options with no remembered default have no default kind', async () => {
    const t = await setup({ resolve: () => Promise.resolve(several(null)) });
    const result = await t.service.projects(ME);
    expect(
      result.projects.map((p) => [p.id, p.default_kind, p.options]),
    ).toEqual([
      [P_EDITOR, null, 2],
      [P_CAP, null, 2],
      [P_GONE, null, 2],
      [P_OWNED, null, 2],
      [P_NONE, null, 2],
    ]);
  });

  it('orders most recently logged first, then by title', async () => {
    const tables = baseTables();
    tables.time_entries.push({
      member_user_id: ME,
      project_id: P_OWNED,
      started_at: '2026-10-04T09:00:00+00:00',
    });
    const t = await setup({
      tables,
      resolve: () => Promise.resolve(one('personal')),
    });
    const result = await t.service.projects(ME);
    expect(result.projects.map((p) => p.title)).toEqual([
      'Mine', // Oct 4
      'Website', // Oct 3
      'Capability', // Oct 1
      'Gone', // never logged: by title
      'Nothing',
    ]);
  });

  it('answers an empty list without resolving anything when the caller can log nowhere', async () => {
    const t = await setup({
      tables: {
        project_access: [
          {
            project_id: P_VIEWER,
            user_id: ME,
            role: 'viewer',
            capabilities: null,
          },
        ],
        projects: [],
        time_entries: [],
      },
    });
    await expect(t.service.projects(ME)).resolves.toEqual({ projects: [] });
    expect(t.resolve).not.toHaveBeenCalled();
  });

  it(`caps at ${MY_PROJECTS_MAX} projects, keeping the most recently logged, and says so`, async () => {
    const n = MY_PROJECTS_MAX + 5;
    const ids = Array.from({ length: n }, (_, i) => uid(1000 + i));
    const tables: Record<string, Row[]> = {
      project_access: ids.map((id) => ({
        project_id: id,
        user_id: ME,
        role: 'editor',
        capabilities: null,
      })),
      projects: ids.map((id, i) => ({
        id,
        title: `Project ${String(i).padStart(3, '0')}`,
        workspace_id: WS,
        status: 'active',
        owner_id: OTHER,
      })),
      // The last five ids were logged most recently.
      time_entries: ids.slice(-5).map((id, i) => ({
        member_user_id: ME,
        project_id: id,
        started_at: `2026-10-0${i + 1}T09:00:00+00:00`,
      })),
    };
    const t = await setup({
      tables,
      resolve: () => Promise.resolve(one('team')),
    });
    const result = await t.service.projects(ME);

    expect(result.truncated).toBe(true);
    expect(result.projects).toHaveLength(MY_PROJECTS_MAX);
    expect(t.resolve).toHaveBeenCalledTimes(MY_PROJECTS_MAX);
    // Logged ones first (newest first), then by title; the five dropped are the last titles.
    expect(result.projects.slice(0, 5).map((p) => p.id)).toEqual(
      ids.slice(-5).reverse(),
    );
    const listed = new Set(result.projects.map((p) => p.id));
    for (const id of ids.slice(MY_PROJECTS_MAX - 5, MY_PROJECTS_MAX)) {
      expect(listed.has(id)).toBe(false);
    }
  });

  it('runs at most 8 resolver calls at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const ids = Array.from({ length: 30 }, (_, i) => uid(2000 + i));
    const t = await setup({
      tables: {
        project_access: ids.map((id) => ({
          project_id: id,
          user_id: ME,
          role: 'editor',
          capabilities: null,
        })),
        projects: ids.map((id) => ({
          id,
          title: id,
          workspace_id: WS,
          status: 'active',
        })),
        time_entries: [],
      },
      resolve: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return one('team');
      },
    });
    const result = await t.service.projects(ME);
    expect(result.projects).toHaveLength(30);
    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(1);
  });

  it('pages the share rows past the 1000-row PostgREST cap', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => uid(5000 + i));
    const t = await setup({
      tables: {
        project_access: ids.map((id) => ({
          project_id: id,
          user_id: ME,
          role: 'viewer',
          capabilities: null,
        })),
        projects: [],
        time_entries: [],
      },
    });
    await t.service.projects(ME);
    const ranges = t.db.calls
      .filter((c) => c.table === 'project_access')
      .map((c) => c.ops.find((op) => op[0] === 'range'));
    expect(ranges).toEqual([
      ['range', 0, 999],
      ['range', 1000, 1999],
    ]);
  });

  describe('cache (30 s per user under the For-resolver epoch)', () => {
    it('serves a second read from the cache, keyed by epoch and user', async () => {
      const redis = fakeRedis();
      redis.store.set(LF_EPOCH_KEY, 7);
      const t = await setup({ redis });

      const first = await t.service.projects(ME);
      const key = myProjectsKey('7', ME);
      expect(key).toBe(`time:mp:7:${ME}`);
      expect(redis.ttl.get(key)).toBe(LF_TTL_SECONDS);
      const calls = t.resolve.mock.calls.length;

      const second = await t.service.projects(ME);
      expect(second).toEqual(first);
      expect(t.resolve).toHaveBeenCalledTimes(calls);
    });

    it('recomputes after an epoch bump', async () => {
      const redis = fakeRedis();
      const t = await setup({ redis });
      await t.service.projects(ME);
      const calls = t.resolve.mock.calls.length;

      redis.store.set(LF_EPOCH_KEY, 1);
      await t.service.projects(ME);
      expect(t.resolve.mock.calls.length).toBe(calls * 2);
    });

    it('decodes a JSON string value too', async () => {
      const redis = fakeRedis();
      const cached: MyProjectsResult = {
        projects: [
          {
            id: P_EDITOR,
            title: 'Cached',
            workspace_id: WS,
            options: 1,
            default_kind: 'team',
            status: 'active',
            last_logged_at: null,
          },
        ],
      };
      redis.store.set(myProjectsKey('0', ME), JSON.stringify(cached));
      const t = await setup({ redis });
      await expect(t.service.projects(ME)).resolves.toEqual(cached);
      expect(t.resolve).not.toHaveBeenCalled();
    });

    it('writes under the epoch read before the compute (D56)', async () => {
      const redis = fakeRedis();
      redis.store.set(LF_EPOCH_KEY, 3);
      const t = await setup({
        redis,
        resolve: (projectId) => {
          // A policy write lands while the answer is being computed.
          redis.store.set(LF_EPOCH_KEY, 4);
          return defaultResolver(projectId);
        },
      });
      await t.service.projects(ME);
      expect(redis.store.has(myProjectsKey('3', ME))).toBe(true);
      expect(redis.store.has(myProjectsKey('4', ME))).toBe(false);
    });

    it('works, uncached, without Redis or with Redis down', async () => {
      const none = await setup({ redis: null });
      await expect(none.service.projects(ME)).resolves.toMatchObject({
        projects: expect.any(Array),
      });
      await none.service.projects(ME);
      expect(none.resolve.mock.calls.length).toBe(10);

      const down = await setup({ redis: fakeRedis(true) });
      const result = await down.service.projects(ME);
      expect(result.projects).toHaveLength(3);
    });

    it('never caches a partial answer', async () => {
      const redis = fakeRedis();
      const t = await setup({
        redis,
        resolve: (projectId) =>
          projectId === P_CAP
            ? Promise.reject(new Error('db down'))
            : defaultResolver(projectId),
      });
      const result = await t.service.projects(ME);
      expect(result.projects.map((p) => p.id)).toEqual([P_EDITOR, P_OWNED]);
      expect(redis.set).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('time_me_projects_resolve_failed'),
      );
    });

    it('a failed "last logged" read still answers, unordered by recency and uncached', async () => {
      const redis = fakeRedis();
      const t = await setup({
        redis,
        errors: { time_entries: { message: 'timeout' } },
      });
      const result = await t.service.projects(ME);
      expect(result.projects.map((p) => p.title)).toEqual([
        'Capability',
        'Mine',
        'Website',
      ]);
      expect(result.projects.every((p) => p.last_logged_at === null)).toBe(
        true,
      );
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('errors', () => {
    it('is a fixed-copy 500 when every project fails to resolve', async () => {
      const t = await setup({
        resolve: () => Promise.reject(new Error('relation "x" does not exist')),
      });
      const err = await t.service.projects(ME).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(500);
      expect((err as HttpException).getResponse()).toEqual({
        code: 'TIME_INTERNAL',
        message: "Proyekto couldn't load your projects. Try again.",
      });
    });

    it('a failed share read is a fixed-copy 500, never Postgres text', async () => {
      const t = await setup({
        errors: {
          project_access: { code: '57014', message: 'canceling statement' },
        },
      });
      const err = await t.service.projects(ME).catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(500);
      expect(
        JSON.stringify((err as HttpException).getResponse()),
      ).not.toContain('canceling');
    });
  });
});

describe('TimeEntriesController A-3 routes', () => {
  const USER = { id: ME };

  it('GET me/projects and GET projects/:id/loggers delegate to their services', async () => {
    const me = { projects: jest.fn(() => Promise.resolve({ projects: [] })) };
    const loggers = {
      forProject: jest.fn(() => Promise.resolve({ people: [] })),
    };
    const controller = new TimeEntriesController(
      {} as never,
      {} as never,
      {} as never,
      me as never,
      loggers as never,
    );
    await expect(controller.myProjects(USER)).resolves.toEqual({
      projects: [],
    });
    expect(me.projects).toHaveBeenCalledWith(ME);
    await expect(controller.loggers(USER, P_EDITOR)).resolves.toEqual({
      people: [],
    });
    expect(loggers.forProject).toHaveBeenCalledWith(ME, P_EDITOR);
  });

  it('a controller built without the A-3 services answers a fixed-copy 500', () => {
    const controller = new TimeEntriesController(
      {} as never,
      {} as never,
      {} as never,
    );
    expect(() => controller.myProjects(USER)).toThrow(HttpException);
    expect(() => controller.loggers(USER, P_EDITOR)).toThrow(HttpException);
  });
});
