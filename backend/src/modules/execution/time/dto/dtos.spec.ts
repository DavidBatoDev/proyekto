import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { getMetadataStorage, validate } from 'class-validator';
import {
  CreateEntryDto,
  CreateCommentDto,
  ListMyEntriesQueryDto,
  StartEntryDto,
  StopEntryDto,
  UpdateEntryDto,
} from './entries.dto';
import {
  CreateManualTimeLogDto,
  CreateTimeLogCommentDto,
  ListLogsQueryDto,
  ReviewTimeLogDto,
  ReviewTimeLogsBulkDto,
  StartTimeLogDto,
  StopTimeLogDto,
  UpdateTimeLogDto,
} from './legacy-team-time.dto';
import {
  LoggingForDto,
  parseLoggingForRef,
  PolicyQueryDto,
  PutLoggingForDto,
} from './logging-for.dto';
import {
  PolicyHistoryQueryDto,
  TeamTimePolicyDto,
  WorkspaceTimePolicyDto,
} from './policies.dto';
import { UpdateTimePreferencesDto } from './preferences.dto';
import { AuditExportQueryDto, ReportQueryDto } from './reports.dto';
import {
  ApprovalsQueryDto,
  ApproveBulkDto,
  TimesheetActionDto,
} from './timesheets.dto';
import * as entriesDto from './entries.dto';
import * as legacyDto from './legacy-team-time.dto';
import * as loggingForDto from './logging-for.dto';
import * as policiesDto from './policies.dto';
import * as preferencesDto from './preferences.dto';
import * as reportsDto from './reports.dto';
import * as timesheetsDto from './timesheets.dto';

/** The global ValidationPipe (main.ts): whitelist + forbidNonWhitelisted + implicit conversion. */
const PIPE = { whitelist: true, forbidNonWhitelisted: true } as const;
type Ctor<T> = new () => T;

async function errorsFor<T extends object>(
  cls: Ctor<T>,
  plain: Record<string, unknown>,
) {
  const dto = plainToInstance(cls, plain, { enableImplicitConversion: true });
  return validate(dto, PIPE);
}

async function ok<T extends object>(
  cls: Ctor<T>,
  plain: Record<string, unknown>,
) {
  const errors = await errorsFor(cls, plain);
  expect(
    errors.map((e) => ({
      property: e.property,
      constraints: e.constraints,
      children: e.children?.length,
    })),
  ).toEqual([]);
}

async function rejected<T extends object>(
  cls: Ctor<T>,
  plain: Record<string, unknown>,
  property: string,
) {
  const errors = await errorsFor(cls, plain);
  expect(errors.map((e) => e.property)).toContain(property);
}

function declaredFields(cls: Ctor<object>): string[] {
  const metas = getMetadataStorage().getTargetValidationMetadatas(
    cls,
    '',
    true,
    false,
  );
  return [...new Set(metas.map((m) => m.propertyName))].sort();
}

const UUID = '7d9f3b0e-4c1a-4f5e-9a2b-1c3d5e7f9a0b';
const UUID2 = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';

describe('time DTOs', () => {
  describe('forbidNonWhitelisted', () => {
    it.each<[string, Ctor<object>, Record<string, unknown>]>([
      ['StartEntryDto', StartEntryDto, { project_id: UUID }],
      [
        'CreateEntryDto',
        CreateEntryDto,
        {
          project_id: UUID,
          started_at: '2026-10-05T09:00:00Z',
          ended_at: '2026-10-05T10:00:00Z',
        },
      ],
      [
        'UpdateEntryDto',
        UpdateEntryDto,
        { expected_updated_at: '2026-10-05T09:00:00Z' },
      ],
      ['StopEntryDto', StopEntryDto, {}],
      ['CreateCommentDto', CreateCommentDto, { body: 'hi' }],
      [
        'ListMyEntriesQueryDto',
        ListMyEntriesQueryDto,
        { from: '2026-10-01', to: '2026-10-31' },
      ],
      ['LoggingForDto', LoggingForDto, { kind: 'personal' }],
      [
        'PutLoggingForDto',
        PutLoggingForDto,
        { logging_for: { kind: 'team', id: UUID } },
      ],
      ['PolicyQueryDto', PolicyQueryDto, {}],
      [
        'UpdateTimePreferencesDto',
        UpdateTimePreferencesDto,
        { timezone: 'Asia/Manila' },
      ],
      ['TimesheetActionDto', TimesheetActionDto, { expected_revision: 0 }],
      [
        'ApproveBulkDto',
        ApproveBulkDto,
        { ids: [UUID], expected_revisions: [1] },
      ],
      ['ApprovalsQueryDto', ApprovalsQueryDto, {}],
      [
        'ReportQueryDto',
        ReportQueryDto,
        { scope: `team:${UUID}`, from: '2026-10-01', to: '2026-10-31' },
      ],
      [
        'AuditExportQueryDto',
        AuditExportQueryDto,
        { scope: `workspace:${UUID}`, from: '2026-10-01', to: '2026-10-31' },
      ],
      ['WorkspaceTimePolicyDto', WorkspaceTimePolicyDto, {}],
      ['TeamTimePolicyDto', TeamTimePolicyDto, {}],
      ['PolicyHistoryQueryDto', PolicyHistoryQueryDto, {}],
    ])(
      '%s accepts a valid body and rejects an unknown field',
      async (_name, cls, valid) => {
        await ok(cls, valid);
        await rejected(cls, { ...valid, surprise: 1 }, 'surprise');
      },
    );

    it('every DTO module class carries validation metadata (class-validator forbidUnknownValues)', () => {
      // A class with no decorated field fails every request with "an unknown value was passed to the validate
      // function" under the global pipe, which is why StopEntryDto has its never-sent sentinel.
      const modules = [
        entriesDto,
        loggingForDto,
        policiesDto,
        preferencesDto,
        reportsDto,
        timesheetsDto,
        legacyDto,
      ];
      const classes = modules.flatMap((m) =>
        Object.values(m as Record<string, unknown>).filter(
          (v: unknown): v is Ctor<object> =>
            typeof v === 'function' && /^[A-Z]\w*Dto$/.test(v.name),
        ),
      );
      expect(classes.length).toBeGreaterThanOrEqual(25);
      for (const cls of classes) {
        expect({
          cls: cls.name,
          fields: declaredFields(cls).length > 0,
        }).toEqual({ cls: cls.name, fields: true });
      }
    });

    it('StopEntryDto refuses any field (the body must be empty)', async () => {
      await rejected(
        StopEntryDto,
        { ended_at: '2026-10-05T10:00:00Z' },
        'ended_at',
      );
    });

    it('a nested logging_for refuses unknown fields too', async () => {
      const errors = await errorsFor(StartEntryDto, {
        project_id: UUID,
        logging_for: { kind: 'team', id: UUID, x: 1 },
      });
      expect(errors.map((e) => e.property)).toContain('logging_for');
    });
  });

  describe('LoggingForDto', () => {
    it('requires a UUID id unless the kind is personal', async () => {
      await ok(LoggingForDto, { kind: 'personal' });
      await ok(LoggingForDto, { kind: 'personal', id: null });
      await ok(LoggingForDto, { kind: 'team', id: UUID });
      await ok(LoggingForDto, { kind: 'assignment', id: UUID });
      await rejected(LoggingForDto, { kind: 'team' }, 'id');
      await rejected(LoggingForDto, { kind: 'workspace', id: null }, 'id');
      await rejected(LoggingForDto, { kind: 'assignment', id: 'nope' }, 'id');
      await rejected(LoggingForDto, { kind: 'client', id: UUID }, 'kind');
    });

    it('PutLoggingForDto requires logging_for', async () => {
      await rejected(PutLoggingForDto, {}, 'logging_for');
      await rejected(
        PutLoggingForDto,
        { logging_for: { kind: 'team' } },
        'logging_for',
      );
    });

    it('PolicyQueryDto takes <kind>:<uuid> or personal:', async () => {
      await ok(PolicyQueryDto, { for: `team:${UUID}` });
      await ok(PolicyQueryDto, { for: 'personal:' });
      await rejected(PolicyQueryDto, { for: 'team:' }, 'for');
      await rejected(PolicyQueryDto, { for: `personal:${UUID}` }, 'for');
      await rejected(PolicyQueryDto, { for: `project:${UUID}` }, 'for');
    });

    it('parseLoggingForRef reads both forms', () => {
      expect(parseLoggingForRef(`team:${UUID}`)).toEqual({
        kind: 'team',
        id: UUID,
      });
      expect(parseLoggingForRef('personal:')).toEqual({
        kind: 'personal',
        id: null,
      });
      expect(parseLoggingForRef(undefined)).toBeNull();
      expect(parseLoggingForRef('')).toBeNull();
    });
  });

  describe('entries', () => {
    it('task_id and note accept null; work_item is a preset only', async () => {
      await ok(StartEntryDto, {
        project_id: UUID,
        task_id: null,
        note: null,
        work_item: 'meeting',
        work_type: 'training',
      });
      await rejected(
        StartEntryDto,
        { project_id: UUID, work_item: 'task' },
        'work_item',
      );
      await rejected(
        StartEntryDto,
        { project_id: UUID, task_id: 'nope' },
        'task_id',
      );
      await rejected(
        StartEntryDto,
        { project_id: UUID, note: 'x'.repeat(2001) },
        'note',
      );
      await rejected(StartEntryDto, {}, 'project_id');
    });

    it('CreateEntryDto bounds breaks', async () => {
      const base = {
        project_id: UUID,
        started_at: '2026-10-05T09:00:00Z',
        ended_at: '2026-10-05T10:00:00Z',
      };
      await ok(CreateEntryDto, {
        ...base,
        break_seconds: 86400,
        break_minutes: 1440,
      });
      await rejected(
        CreateEntryDto,
        { ...base, break_seconds: 86401 },
        'break_seconds',
      );
      await rejected(
        CreateEntryDto,
        { ...base, break_minutes: -1 },
        'break_minutes',
      );
      await rejected(
        CreateEntryDto,
        { project_id: UUID, ended_at: base.ended_at },
        'started_at',
      );
    });

    it('UpdateEntryDto requires expected_updated_at (D42)', async () => {
      await rejected(UpdateEntryDto, { note: 'x' }, 'expected_updated_at');
    });

    it('CreateCommentDto needs 1-4000 characters', async () => {
      await rejected(CreateCommentDto, { body: '' }, 'body');
      await rejected(CreateCommentDto, { body: 'x'.repeat(4001) }, 'body');
      await ok(CreateCommentDto, { body: 'x'.repeat(4000) });
    });

    it('ListMyEntriesQueryDto converts paging, defaults it and caps limit at 200', async () => {
      const dto = plainToInstance(ListMyEntriesQueryDto, {
        from: '2026-10-01',
        to: '2026-10-31',
      });
      expect(dto.page).toBe(1);
      expect(dto.limit).toBe(100);
      await ok(ListMyEntriesQueryDto, {
        from: '2026-10-01',
        to: '2026-10-31',
        page: '2',
        limit: '200',
        for: 'personal:',
      });
      await rejected(
        ListMyEntriesQueryDto,
        { from: '2026-10-01', to: '2026-10-31', limit: '201' },
        'limit',
      );
      await rejected(
        ListMyEntriesQueryDto,
        { from: '2026-02-30', to: '2026-10-31' },
        'from',
      );
    });
  });

  describe('timesheets', () => {
    it('ApproveBulkDto takes 1 to 100 unique UUIDs', async () => {
      const ids = (n: number) =>
        Array.from(
          { length: n },
          (_v, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        );
      await ok(ApproveBulkDto, { ids: ids(1), expected_revisions: [0] });
      await ok(ApproveBulkDto, {
        ids: ids(100),
        expected_revisions: Array(100).fill(1),
      });
      await rejected(
        ApproveBulkDto,
        { ids: [], expected_revisions: [] },
        'ids',
      );
      await rejected(
        ApproveBulkDto,
        { ids: ids(101), expected_revisions: Array(101).fill(1) },
        'ids',
      );
      await rejected(
        ApproveBulkDto,
        { ids: [UUID, UUID], expected_revisions: [1, 1] },
        'ids',
      );
      await rejected(
        ApproveBulkDto,
        { ids: ['nope'], expected_revisions: [1] },
        'ids',
      );
      await rejected(
        ApproveBulkDto,
        { ids: [UUID, UUID2], expected_revisions: [1, 'x'] },
        'expected_revisions',
      );
    });

    it('TimesheetActionDto needs a non-negative revision', async () => {
      await ok(TimesheetActionDto, {
        expected_revision: 3,
        note: 'ok',
        approve_overtime: true,
      });
      await rejected(TimesheetActionDto, {}, 'expected_revision');
      await rejected(
        TimesheetActionDto,
        { expected_revision: -1 },
        'expected_revision',
      );
      await rejected(
        TimesheetActionDto,
        { expected_revision: 1, note: 'x'.repeat(2001) },
        'note',
      );
    });

    it('ApprovalsQueryDto defaults to the waiting list', async () => {
      const dto = plainToInstance(ApprovalsQueryDto, {});
      expect(dto).toMatchObject({ status: 'submitted', page: 1, limit: 50 });
      await rejected(ApprovalsQueryDto, { status: 'approved' }, 'status');
      await rejected(ApprovalsQueryDto, { limit: '101' }, 'limit');
    });
  });

  describe('reports, preferences, policies', () => {
    it('ReportQueryDto scopes', async () => {
      const range = { from: '2026-10-01', to: '2026-10-31' };
      for (const kind of ['team', 'project', 'workspace', 'engagement']) {
        await ok(ReportQueryDto, { ...range, scope: `${kind}:${UUID}` });
      }
      await rejected(
        ReportQueryDto,
        { ...range, scope: `assignment:${UUID}` },
        'scope',
      );
      await rejected(
        ReportQueryDto,
        { ...range, scope: `team:${UUID}`, context_kind: 'personal' },
        'context_kind',
      );
      await rejected(
        AuditExportQueryDto,
        { ...range, scope: `team:${UUID}` },
        'scope',
      );
    });

    it('ReportQueryDto group_by takes week (A5) beside the other groupings', async () => {
      const base = {
        scope: `team:${UUID}`,
        from: '2026-10-01',
        to: '2026-10-31',
      };
      for (const group_by of [
        'day',
        'week',
        'member',
        'project',
        'task',
        'context',
      ]) {
        await ok(ReportQueryDto, { ...base, group_by });
      }
      await rejected(
        ReportQueryDto,
        { ...base, group_by: 'month' },
        'group_by',
      );
    });

    it('PolicyHistoryQueryDto pages 1.. with a limit of 1..100 (A7), query strings converted', async () => {
      await ok(PolicyHistoryQueryDto, { page: '2', limit: '100' });
      const dto = plainToInstance(PolicyHistoryQueryDto, {});
      expect(dto).toEqual(expect.objectContaining({ page: 1, limit: 20 }));
      await rejected(PolicyHistoryQueryDto, { page: 0 }, 'page');
      await rejected(PolicyHistoryQueryDto, { limit: 101 }, 'limit');
      await rejected(PolicyHistoryQueryDto, { limit: 'many' }, 'limit');
    });

    it('UpdateTimePreferencesDto needs an IANA timezone', async () => {
      await ok(UpdateTimePreferencesDto, {
        timezone: 'America/New_York',
        week_start: 7,
      });
      await ok(UpdateTimePreferencesDto, { timezone: 'UTC', week_start: null });
      await rejected(
        UpdateTimePreferencesDto,
        { timezone: 'Not/AZone' },
        'timezone',
      );
      await rejected(
        UpdateTimePreferencesDto,
        { timezone: 'UTC', week_start: 8 },
        'week_start',
      );
    });

    it('WorkspaceTimePolicyDto validates each field', async () => {
      await ok(WorkspaceTimePolicyDto, {
        tracking_enabled: true,
        period_kind: 'biweekly',
        week_start: 1,
        timezone: 'Asia/Manila',
        period_anchor: '2026-09-28',
        approval_required: true,
        allow_manual_entries: false,
        retroactive_days: null,
        rounding_minutes: 15,
        weekly_limit_minutes: null,
        reminder_days: 2,
        hidden_presets: ['admin'],
        confirm: true,
      });
      await rejected(
        WorkspaceTimePolicyDto,
        { rounding_minutes: 7 },
        'rounding_minutes',
      );
      await rejected(
        WorkspaceTimePolicyDto,
        { retroactive_days: 3651 },
        'retroactive_days',
      );
      await rejected(
        WorkspaceTimePolicyDto,
        { hidden_presets: ['task'] },
        'hidden_presets',
      );
      await rejected(
        WorkspaceTimePolicyDto,
        { reminder_days: 15 },
        'reminder_days',
      );
    });

    it('TeamTimePolicyDto takes null to inherit, only team routing, and no workspace-only fields', async () => {
      await ok(TeamTimePolicyDto, {
        period_kind: null,
        week_start: null,
        timezone: null,
        period_anchor: null,
        approval_required: null,
        approver_scope: null,
        allow_manual_entries: null,
        retroactive_days: null,
        rounding_minutes: null,
        weekly_limit_minutes: null,
        reminder_days: null,
      });
      await ok(TeamTimePolicyDto, {
        approver_scope: 'team',
        retroactive_days: 30,
        rounding_minutes: 6,
      });
      await rejected(
        TeamTimePolicyDto,
        { approver_scope: 'workspace' },
        'approver_scope',
      );
      await rejected(
        TeamTimePolicyDto,
        { tracking_enabled: true },
        'tracking_enabled',
      );
      await rejected(
        TeamTimePolicyDto,
        { hidden_presets: [] },
        'hidden_presets',
      );
      await rejected(TeamTimePolicyDto, { timezone: 'Not/AZone' }, 'timezone');
    });
  });

  describe('legacy team-time DTOs (byte-compatible with old clients)', () => {
    // Frozen from the pre-PR-1 time-log DTOs at 91d227aa: an old body must never meet forbidNonWhitelisted.
    it.each<[string, Ctor<object>, string[]]>([
      ['StartTimeLogDto', StartTimeLogDto, ['project_id', 'task_id']],
      ['StopTimeLogDto', StopTimeLogDto, ['break_minutes', 'ended_at']],
      [
        'UpdateTimeLogDto',
        UpdateTimeLogDto,
        ['break_minutes', 'ended_at', 'started_at', 'task_id'],
      ],
      [
        'CreateManualTimeLogDto',
        CreateManualTimeLogDto,
        ['break_minutes', 'ended_at', 'project_id', 'started_at', 'task_id'],
      ],
      ['ReviewTimeLogDto', ReviewTimeLogDto, ['decision', 'reason']],
      [
        'ReviewTimeLogsBulkDto',
        ReviewTimeLogsBulkDto,
        ['decision', 'log_ids', 'reason'],
      ],
      ['CreateTimeLogCommentDto', CreateTimeLogCommentDto, ['body']],
      [
        'ListLogsQueryDto',
        ListLogsQueryDto,
        [
          'from',
          'limit',
          'member_user_id',
          'page',
          'project_id',
          'status',
          'task_status',
          'to',
        ],
      ],
    ])('%s declares exactly the old fields', (_name, cls, fields) => {
      expect(declaredFields(cls)).toEqual([...fields].sort());
    });

    it('accepts the bodies the deployed web sends', async () => {
      await ok(StartTimeLogDto, { project_id: UUID, task_id: null });
      await ok(StartTimeLogDto, { project_id: UUID, task_id: 'null' });
      await ok(StopTimeLogDto, {});
      await ok(UpdateTimeLogDto, {
        started_at: '2026-10-05T09:00:00Z',
        ended_at: '2026-10-05T10:00:00Z',
        break_minutes: 5,
      });
      await ok(CreateManualTimeLogDto, {
        project_id: UUID,
        task_id: UUID2,
        started_at: '2026-10-05T09:00:00Z',
        ended_at: '2026-10-05T10:00:00Z',
      });
      await ok(CreateTimeLogCommentDto, { body: 'Looks good' });
      await ok(ListLogsQueryDto, {
        status: 'approved',
        page: '1',
        limit: '200',
        from: '2026-10-01',
        to: '2026-10-31',
      });
    });
  });
});
