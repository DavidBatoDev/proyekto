import { HttpException, Logger, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { LoggingContextService } from './logging-context.service';
import { TimeAuthorityService } from './time-authority.service';
import {
  LOGGER_PERSONAL_LABEL,
  LOGGERS_MAX,
  loggerLabel,
  TimeLoggersService,
} from './time-loggers.service';
import { ROSTER_MASKED_LABEL } from './time-projects.facade';
import type {
  ContextKind,
  LoggingForResult,
  LoggingOption,
  ProjectLogger,
} from './time.types';

// ── ids ─────────────────────────────────────────────────────────────────────
const uid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const PROJECT = uid(10);
const OWNER = uid(1); // projects.owner_id, with no share row
const ADMIN = uid(2);
const MARIA = uid(3); // editor, team
const RICO = uid(4); // editor, workspace
const LEO = uid(5); // placed talent, agreement
const SAM = uid(6); // placed talent, but logs for a team
const VIEWER = uid(7);
const COMMENTER = uid(8);
const CAPPED = uid(9); // commenter granted time.log by a capability
const GONE = uid(11); // deleted account
const EDITOR_VIEWER = uid(12); // editor whose resolve fails

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
    builder.order = chain('order', (col) => {
      rows.sort((a, b) => {
        const x = (a[col as string] as string | null) ?? '';
        const y = (b[col as string] as string | null) ?? '';
        return x < y ? -1 : x > y ? 1 : 0;
      });
    });
    builder.range = chain('range', (a, b) => {
      range = [a as number, b as number];
    });
    const result = () => {
      const error = errors[table];
      if (error) return { data: null, error };
      return {
        data: range ? rows.slice(range[0], range[1] + 1) : rows,
        error: null,
      };
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
  return { sb: { from }, calls };
}

function option(kind: ContextKind, label: string): LoggingOption {
  return {
    kind,
    id: kind === 'personal' ? null : uid(90),
    label,
    sheet_scope: kind === 'personal' ? null : { kind: 'team', ref: uid(90) },
    rate_source: 'none',
    workspace_tag: null,
    approver_hint: null,
  };
}

function only(o: LoggingOption): LoggingForResult {
  return { options: [o], selected: o, prefill: null, unavailable: [] };
}

const TEAM_OPTION = option('team', 'Prodigitality Services Inc. Team');
const WS_OPTION = option('workspace', 'Acme');
const AGREEMENT = option('assignment', 'Pixel Studio');
const PERSONAL = option('personal', 'Just me');

function access(
  id: number,
  userId: string,
  role: string,
  capabilities: Row | null = null,
): Row {
  return {
    id: uid(100 + id),
    project_id: PROJECT,
    user_id: userId,
    role,
    capabilities,
  };
}

function baseTables(): Record<string, Row[]> {
  return {
    projects: [{ id: PROJECT, owner_id: OWNER }],
    project_access: [
      access(1, ADMIN, 'admin'),
      access(2, MARIA, 'editor'),
      access(3, RICO, 'editor'),
      access(4, LEO, 'editor'),
      access(5, SAM, 'editor'),
      access(6, VIEWER, 'viewer'),
      access(7, COMMENTER, 'commenter'),
      access(8, CAPPED, 'commenter', { 'access.time': true, 'time.log': true }),
      access(9, GONE, 'editor'),
      // Another project's row never counts.
      { ...access(10, VIEWER, 'owner'), project_id: uid(99) },
    ],
    profiles: [
      { id: OWNER, display_name: 'Olive Owner', deleted_at: null },
      { id: ADMIN, display_name: 'Ana Reyes', deleted_at: null },
      { id: MARIA, display_name: 'Maria', deleted_at: null },
      { id: RICO, display_name: 'Rico', deleted_at: null },
      { id: LEO, display_name: 'Leo', deleted_at: null },
      { id: SAM, display_name: 'Sam', deleted_at: null },
      { id: VIEWER, display_name: 'Vic', deleted_at: null },
      { id: COMMENTER, display_name: 'Cora', deleted_at: null },
      { id: CAPPED, display_name: 'Cap', deleted_at: null },
      { id: GONE, display_name: 'Gone', deleted_at: '2026-09-01T00:00:00Z' },
    ],
  };
}

const RESULTS: Record<string, LoggingForResult> = {
  [OWNER]: only(PERSONAL),
  [ADMIN]: {
    // Several options, a remembered prefill: the prefill is primary.
    options: [AGREEMENT, TEAM_OPTION],
    selected: null,
    prefill: TEAM_OPTION,
    reason: 'confirm',
    unavailable: [],
  },
  [MARIA]: only(TEAM_OPTION),
  [RICO]: only(WS_OPTION),
  [LEO]: only(AGREEMENT),
  [SAM]: only(TEAM_OPTION),
  [CAPPED]: {
    // Several, no prefill: the first is primary.
    options: [AGREEMENT, PERSONAL],
    selected: null,
    prefill: null,
    reason: 'required',
    unavailable: [],
  },
};

async function setup(
  o: {
    tables?: Record<string, Row[]>;
    errors?: Record<string, { code?: string; message: string }>;
    masked?: string[];
    resolve?: (userId: string) => Promise<LoggingForResult>;
  } = {},
) {
  const db = fakeDb(o.tables ?? baseTables(), o.errors);
  const resolve = jest.fn(
    (...args: [string, string, { at: Date; purpose: string }]) =>
      o.resolve
        ? o.resolve(args[0])
        : Promise.resolve(
            RESULTS[args[0]] ?? {
              options: [],
              selected: null,
              prefill: null,
              reason: 'none' as const,
              unavailable: [],
            },
          ),
  );
  const authority = {
    maskedWorkerIds: jest.fn(() => Promise.resolve(new Set(o.masked ?? []))),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      TimeLoggersService,
      { provide: SUPABASE_ADMIN, useValue: db.sb },
      { provide: LoggingContextService, useValue: { resolve } },
      { provide: TimeAuthorityService, useValue: authority },
    ],
  }).compile();
  return { service: moduleRef.get(TimeLoggersService), db, resolve, authority };
}

const byUser = (people: ProjectLogger[]) =>
  new Map(people.map((p) => [p.user_id, p]));

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

describe('loggerLabel', () => {
  it.each([
    ['team', TEAM_OPTION, 'Prodigitality Services Inc. Team'],
    ['workspace', WS_OPTION, 'Acme'],
    ['agreement', AGREEMENT, 'agreement with Pixel Studio'],
    ['personal', PERSONAL, LOGGER_PERSONAL_LABEL],
  ] as const)('a %s option', (reason, o, label) => {
    expect(loggerLabel(o)).toEqual({ reason, label });
  });

  it('never says "contract", "rate", "payout" or "invoice"', () => {
    for (const o of [TEAM_OPTION, WS_OPTION, AGREEMENT, PERSONAL]) {
      expect(loggerLabel(o).label).not.toMatch(/contract|rate|payout|invoice/i);
    }
  });
});

describe('TimeLoggersService.forProject (A11)', () => {
  describe('who may ask', () => {
    it.each([
      ['a project admin', ADMIN],
      ['the owner by projects.owner_id (no share row)', OWNER],
    ])('%s gets the list', async (_label, viewer) => {
      const t = await setup();
      await expect(t.service.forProject(viewer, PROJECT)).resolves.toEqual({
        people: expect.any(Array),
      });
    });

    it('an owner by share row gets the list', async () => {
      const tables = baseTables();
      tables.project_access.push(access(20, uid(50), 'owner'));
      const t = await setup({ tables });
      await expect(t.service.forProject(uid(50), PROJECT)).resolves.toEqual({
        people: expect.any(Array),
      });
    });

    it.each([
      ['an editor', MARIA],
      ['a viewer', VIEWER],
      ['a stranger', uid(77)],
      ['a member of another project only', uid(99)],
    ])('%s gets a 404 before anything else is read', async (_label, viewer) => {
      const t = await setup();
      const err = await t.service
        .forProject(viewer, PROJECT)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as HttpException).getResponse()).toMatchObject({
        code: 'TIME_NOT_FOUND',
      });
      expect(t.resolve).not.toHaveBeenCalled();
      expect(t.authority.maskedWorkerIds).not.toHaveBeenCalled();
      expect(t.db.calls.some((c) => c.table === 'profiles')).toBe(false);
    });

    it('a project that does not exist is the same 404', async () => {
      const t = await setup();
      await expect(t.service.forProject(ADMIN, uid(98))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      const malformed = await setup({
        errors: {
          projects: { code: '22P02', message: 'invalid input syntax' },
        },
      });
      await expect(
        malformed.service.forProject(ADMIN, 'nope'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('lists everyone with time.log, with their primary option as a phrase', async () => {
    const t = await setup();
    const { people, truncated } = await t.service.forProject(ADMIN, PROJECT);
    expect(truncated).toBeUndefined();

    const rows = byUser(people);
    expect(rows.get(OWNER)).toEqual({
      user_id: OWNER,
      display_name: 'Olive Owner',
      role: 'owner',
      reason: 'personal',
      label: 'just you',
      options: 1,
    });
    expect(rows.get(ADMIN)).toMatchObject({
      role: 'admin',
      reason: 'team',
      label: 'Prodigitality Services Inc. Team',
      options: 2,
    });
    expect(rows.get(MARIA)).toMatchObject({ role: 'editor', reason: 'team' });
    expect(rows.get(RICO)).toMatchObject({
      reason: 'workspace',
      label: 'Acme',
    });
    expect(rows.get(LEO)).toMatchObject({
      reason: 'agreement',
      label: 'agreement with Pixel Studio',
    });
    // A capability can grant time.log below editor: they can log, so they are listed.
    expect(rows.get(CAPPED)).toMatchObject({
      role: 'commenter',
      reason: 'agreement',
      options: 2,
    });
    // Viewers and commenters cannot log; a deleted account is never listed.
    for (const id of [VIEWER, COMMENTER, GONE])
      expect(rows.has(id)).toBe(false);
    expect(t.resolve).not.toHaveBeenCalledWith(
      VIEWER,
      expect.anything(),
      expect.anything(),
    );
    for (const [, projectId, opts] of t.resolve.mock.calls) {
      expect(projectId).toBe(PROJECT);
      expect(opts.purpose).toBe('read');
    }
  });

  it('sorts by name', async () => {
    const t = await setup();
    const { people } = await t.service.forProject(ADMIN, PROJECT);
    expect(people.map((p) => p.display_name)).toEqual([
      'Ana Reyes',
      'Cap',
      'Leo',
      'Maria',
      'Olive Owner',
      'Rico',
      'Sam',
    ]);
  });

  it('takes the strongest share row as the role', async () => {
    const tables = baseTables();
    tables.project_access.push(access(21, MARIA, 'admin'));
    const t = await setup({ tables });
    const { people } = await t.service.forProject(ADMIN, PROJECT);
    expect(byUser(people).get(MARIA)?.role).toBe('admin');
  });

  describe('placed talent (L22)', () => {
    it('a viewer who may not name a worker sees no agreement row and a masked team row', async () => {
      const t = await setup({ masked: [LEO, SAM] });
      const { people } = await t.service.forProject(ADMIN, PROJECT);

      expect(t.authority.maskedWorkerIds).toHaveBeenCalledWith(PROJECT, ADMIN);
      const ids = people.map((p) => p.user_id);
      expect(ids).not.toContain(LEO);
      expect(ids).not.toContain(SAM);
      expect(
        people.some(
          (p) => p.label.includes('Pixel Studio') && p.display_name === 'Leo',
        ),
      ).toBe(false);
      // Sam logs for a team, so the row stays, masked as on the project roster.
      const masked = people.filter((p) => p.user_id.startsWith('masked:'));
      expect(masked).toEqual([
        {
          user_id: `masked:${uid(105)}`,
          display_name: ROSTER_MASKED_LABEL,
          role: 'editor',
          reason: 'team',
          label: 'Prodigitality Services Inc. Team',
          options: 1,
        },
      ]);
      // Masked rows sort last.
      expect(people[people.length - 1].user_id).toBe(`masked:${uid(105)}`);
    });

    it('a provider-side viewer sees the agreement row with the name', async () => {
      const t = await setup({ masked: [] });
      const { people } = await t.service.forProject(ADMIN, PROJECT);
      expect(byUser(people).get(LEO)).toMatchObject({
        display_name: 'Leo',
        reason: 'agreement',
        label: 'agreement with Pixel Studio',
      });
    });
  });

  describe('resolver outcomes', () => {
    it('a failed resolve lists the person as `none`, unless they are masked', async () => {
      const tables = baseTables();
      tables.project_access.push(access(22, EDITOR_VIEWER, 'editor'));
      tables.profiles.push({
        id: EDITOR_VIEWER,
        display_name: 'Eve',
        deleted_at: null,
      });
      const t = await setup({
        tables,
        masked: [LEO],
        resolve: (userId) =>
          userId === EDITOR_VIEWER || userId === LEO
            ? Promise.reject(new Error('db down'))
            : Promise.resolve(RESULTS[userId]),
      });
      const { people } = await t.service.forProject(ADMIN, PROJECT);
      expect(byUser(people).get(EDITOR_VIEWER)).toEqual({
        user_id: EDITOR_VIEWER,
        display_name: 'Eve',
        role: 'editor',
        reason: 'none',
        label: '',
        options: 0,
      });
      expect(people.some((p) => p.user_id === LEO)).toBe(false);
      expect(people.some((p) => p.user_id.startsWith('masked:'))).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('time_loggers_resolve_failed'),
      );
    });

    it('a 404 or an empty answer (access gone meanwhile) leaves the person out', async () => {
      const t = await setup({
        resolve: (userId) =>
          userId === MARIA
            ? Promise.reject(new NotFoundException({ code: 'TIME_NOT_FOUND' }))
            : userId === RICO
              ? Promise.resolve({
                  options: [],
                  selected: null,
                  prefill: null,
                  reason: 'none' as const,
                  unavailable: [],
                })
              : Promise.resolve(RESULTS[userId]),
      });
      const { people } = await t.service.forProject(ADMIN, PROJECT);
      const ids = people.map((p) => p.user_id);
      expect(ids).not.toContain(MARIA);
      expect(ids).not.toContain(RICO);
      expect(ids).toContain(ADMIN);
    });

    it('is a fixed-copy 500 when nobody could be resolved', async () => {
      const t = await setup({
        resolve: () => Promise.reject(new Error('relation "x" does not exist')),
      });
      const err = await t.service
        .forProject(ADMIN, PROJECT)
        .catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(500);
      expect((err as HttpException).getResponse()).toEqual({
        code: 'TIME_INTERNAL',
        message: "Proyekto couldn't load who can log time here. Try again.",
      });
    });

    it('a failed share read is a fixed-copy 500, never Postgres text', async () => {
      const t = await setup({
        errors: {
          project_access: { code: '57014', message: 'canceling statement' },
        },
      });
      const err = await t.service
        .forProject(ADMIN, PROJECT)
        .catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(500);
      expect(
        JSON.stringify((err as HttpException).getResponse()),
      ).not.toContain('canceling');
    });
  });

  it(`resolves at most ${LOGGERS_MAX} people and says so`, async () => {
    const n = LOGGERS_MAX + 3;
    const ids = Array.from({ length: n }, (_, i) => uid(3000 + i));
    const tables: Record<string, Row[]> = {
      projects: [{ id: PROJECT, owner_id: null }],
      project_access: [
        access(1, ADMIN, 'admin'),
        ...ids.map((id, i) => access(500 + i, id, 'editor')),
      ],
      profiles: [ADMIN, ...ids].map((id) => ({
        id,
        display_name: id,
        deleted_at: null,
      })),
    };
    const t = await setup({
      tables,
      resolve: () => Promise.resolve(only(TEAM_OPTION)),
    });
    const result = await t.service.forProject(ADMIN, PROJECT);
    expect(result.truncated).toBe(true);
    expect(result.people).toHaveLength(LOGGERS_MAX);
    expect(t.resolve).toHaveBeenCalledTimes(LOGGERS_MAX);
  });
});
