import {
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
  Logger,
  NotFoundException,
  ParseUUIDPipe,
  RequestMethod,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import type { Redis } from '@upstash/redis';
import request from 'supertest';
import type { App } from 'supertest/types';
import { IS_PUBLIC_KEY } from '../../../../common/decorators/public.decorator';
import { HttpExceptionFilter } from '../../../../common/filters/http-exception.filter';
import { CronSecretGuard } from '../../../../common/guards/cron-secret.guard';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import { ResponseInterceptor } from '../../../../common/interceptors/response.interceptor';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import type { ListLogsQueryDto } from '../dto/legacy-team-time.dto';
import {
  TIME_GUEST_EMPTY_SHAPE,
  TimeGuestGuard,
} from '../guards/time-guest.guard';
import {
  ALIAS_FLUSH_INTERVAL_MS,
  ALIAS_ROUTE_KEY,
  AliasTelemetryInterceptor,
} from '../legacy/alias-telemetry.interceptor';
import { legacySummary, toLegacyLog } from '../legacy/team-time-legacy.mapper';
import { TeamTimeLegacyService } from '../legacy/team-time-legacy.service';
import { ALIAS_HITS_TTL_SECONDS, TimeCacheService } from '../time-cache';
import { TimeEntriesService } from '../time-entries.service';
import {
  ALIAS_LOCKED_MESSAGE,
  ALIAS_REVIEW_GONE_MESSAGE,
  RUNNING_TIMER_MESSAGE,
  throwTimeDb,
} from '../time-errors';
import type { CommentRow, SegmentRow, TimeEntryView } from '../time.types';
import { TeamTimeLegacyController } from './team-time-legacy.controller';

// ── Ids and fixtures ──────────────────────────────────────────────────────────────────────────────────────────

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOG = '99999999-9999-4999-8999-999999999999';
const TEAM = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';
const WEB_ORIGIN = 'https://app.proyekto.tech';
/** The alias prefix as main.ts serves it (global prefix `api`). */
const ALIAS = '/api/team-time';

const USER: AuthenticatedUser = { id: ME };
const GUEST: AuthenticatedUser = { id: 'guest-1', is_guest: true };

function view(partial: Partial<TimeEntryView> = {}): TimeEntryView {
  return {
    id: LOG,
    context_kind: 'team',
    context_ref: TEAM,
    context_label_snapshot: 'Design team',
    timesheet_id: 's1',
    work_item: 'task',
    started_at: '2026-09-02T01:00:00.000Z',
    ended_at: null,
    paused_at: null,
    duration_seconds: null,
    break_seconds: 0,
    break_minutes: 0,
    payable_seconds: null,
    source: 'timer',
    work_type_snapshot: 'real_work',
    legacy_status: null,
    payout_id: null,
    flagged_reason: null,
    project_id: PROJECT,
    team_id: TEAM,
    workspace_id: null,
    engagement_assignment_id: null,
    created_at: '2026-09-02T01:00:00.000Z',
    updated_at: '2026-09-02T01:00:00.000Z',
    timesheet: null,
    locked_reason: null,
    identity: 'visible',
    member_user_id: ME,
    member_display_name_snapshot: 'Me',
    member: { id: ME, display_name: 'Me', avatar_url: null, email: 'me@x.io' },
    member_label: null,
    content: 'visible',
    task_id: TASK,
    note: null,
    task: { id: TASK, title: 'Logo', work_type: 'real_work', status: 'todo' },
    project: { id: PROJECT, title: 'Acme site' },
    content_label: null,
    cost: 'visible',
    rate_snapshot: 20,
    rate_type_snapshot: 'hourly',
    currency_snapshot: 'USD',
    amount_snapshot: null,
    ...partial,
  };
}

const SEGMENT: SegmentRow = {
  id: 'g1',
  entry_id: LOG,
  kind: 'work',
  started_at: '2026-09-02T01:00:00.000Z',
  ended_at: null,
  created_at: '2026-09-02T01:00:00.000Z',
};
const COMMENT: CommentRow = {
  id: 'c1',
  entry_id: LOG,
  author_user_id: ME,
  body: 'Done',
  created_at: '2026-09-02T04:00:00.000Z',
  updated_at: '2026-09-02T04:00:00.000Z',
  author: {
    id: ME,
    display_name: 'Me',
    avatar_url: null,
    first_name: 'M',
    last_name: 'E',
    email: 'me@x.io',
  },
};
const TASK_OPTION = {
  id: TASK,
  title: 'Logo',
  work_type: 'real_work' as const,
  feature_id: 'f1',
  feature_title: 'Brand',
  epic_id: 'ep1',
  epic_title: 'Launch',
};
const LIST = { items: [toLegacyLog(view(), { cost: true })], total: 1 };
const SUMMARY = legacySummary([]);

/** The Row fields the old web reads (compat.md §1 "Row", web TaskTimeLog). */
const ROW_KEYS = [
  'id',
  'project_id',
  'task_id',
  'member_user_id',
  'team_id',
  'started_at',
  'ended_at',
  'duration_seconds',
  'break_minutes',
  'break_seconds',
  'paused_at',
  'status',
  'reviewed_by',
  'reviewed_at',
  'review_note',
  'source',
  'rate_snapshot',
  'currency_snapshot',
  'work_type_snapshot',
  'created_at',
  'updated_at',
  'task',
  'member',
  'reviewer',
  'project',
];
const LIST_KEYS = ['items', 'total'];
const SUMMARY_KEYS = ['buckets', 'currencies', 'totalHours', 'statusCounts'];
const SEGMENT_KEYS = [
  'id',
  'log_id',
  'kind',
  'started_at',
  'ended_at',
  'created_at',
];
const COMMENT_KEYS = [
  'id',
  'log_id',
  'author_user_id',
  'body',
  'created_at',
  'updated_at',
  'author',
];
const TASK_KEYS = [
  'id',
  'title',
  'work_type',
  'feature_id',
  'feature_title',
  'epic_id',
  'epic_title',
];

function mocks() {
  const entries = {
    start: jest.fn().mockResolvedValue({ ...view(), warnings: [] }),
    createManual: jest.fn().mockResolvedValue({
      ...view({ source: 'manual', ended_at: '2026-09-02T02:00:00.000Z' }),
      warnings: [{ code: 'OVERLAP', entry_ids: ['x'] }],
    }),
    stop: jest
      .fn()
      .mockResolvedValue(view({ ended_at: '2026-09-02T02:00:00.000Z' })),
    pause: jest
      .fn()
      .mockResolvedValue(view({ paused_at: '2026-09-02T01:30:00.000Z' })),
    resume: jest.fn().mockResolvedValue(view({ break_seconds: 300 })),
    update: jest.fn().mockResolvedValue(view()),
    remove: jest.fn().mockResolvedValue(undefined),
    getRunning: jest.fn().mockResolvedValue(view()),
    get: jest.fn().mockResolvedValue(view()),
    listSegments: jest.fn().mockResolvedValue([SEGMENT]),
    listComments: jest.fn().mockResolvedValue([COMMENT]),
    addComment: jest.fn().mockResolvedValue(COMMENT),
    workItems: jest
      .fn()
      .mockResolvedValue({ tasks: [TASK_OPTION], presets: ['meeting'] }),
  };
  const legacy = {
    rows: jest.fn((views: TimeEntryView[], o: { cost: boolean }) =>
      Promise.resolve(views.map((v) => toLegacyLog(v, { cost: o.cost }))),
    ),
    listTeamMine: jest.fn().mockResolvedValue(LIST),
    teamMineSummary: jest.fn().mockResolvedValue(SUMMARY),
    teamTasks: jest.fn().mockResolvedValue([TASK_OPTION]),
    listTeam: jest.fn().mockResolvedValue(LIST),
    teamSummary: jest.fn().mockResolvedValue(SUMMARY),
    teamProjects: jest
      .fn()
      .mockResolvedValue([{ id: PROJECT, title: 'Acme site' }]),
    teamMembers: jest
      .fn()
      .mockResolvedValue([{ id: ME, display_name: 'Me', email: 'me@x.io' }]),
    contractStatus: jest
      .fn()
      .mockResolvedValue({ enforcement: 'off', engagement_status: 'engaged' }),
    listProjectMine: jest.fn().mockResolvedValue(LIST),
    projectMineSummary: jest.fn().mockResolvedValue(SUMMARY),
    listProject: jest.fn().mockResolvedValue(LIST),
    projectSummary: jest.fn().mockResolvedValue(SUMMARY),
    projectMembers: jest
      .fn()
      .mockResolvedValue([{ id: ME, display_name: 'Me' }]),
  };
  return { entries, legacy };
}
type Mocks = ReturnType<typeof mocks>;

function reqWith(origin?: string): Request {
  return { headers: origin ? { origin } : {} } as unknown as Request;
}

const QUERY = {
  status: 'approved',
  from: '2026-09-01',
  to: '2026-09-30',
  limit: 200,
} as ListLogsQueryDto;

// ── The route table: the old controller's 30 routes, in its declaration order ─────────────────────────────────

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
type Handler = keyof TeamTimeLegacyController;
interface RouteCase {
  id: string;
  method: Method;
  path: string;
  handler: Handler;
  /** Path params that must 404 when they are not a UUID (CC13). */
  ids: string[];
  /** Calls the handler the way Nest would. */
  call: (c: TeamTimeLegacyController, req: Request) => unknown;
  /** Asserts the delegation and the response shape the old types read. */
  verify: (m: Mocks, result: unknown, req: Request) => void;
}

const nativeOf = (req: Request) =>
  req.headers.origin === 'capacitor://localhost';
const keysOf = (value: unknown, keys: string[]) => {
  for (const key of keys) expect(value).toHaveProperty(key);
};
const rowVerify =
  (fn: keyof Mocks['entries'], args: (req: Request) => unknown[]) =>
  (m: Mocks, result: unknown, req: Request) => {
    expect(m.entries[fn]).toHaveBeenCalledWith(...args(req));
    // CC13: the write result is re-read through the legacy Row builder.
    expect(m.legacy.rows).toHaveBeenCalledWith([expect.any(Object)], {
      cost: true,
      write: true,
    });
    keysOf(result, ROW_KEYS);
    expect(result).not.toHaveProperty('warnings');
    expect(result).not.toHaveProperty('contract_warning');
  };

const ROUTES: RouteCase[] = [
  {
    id: 'cron.heal',
    method: 'POST',
    path: 'cron/heal-orphaned-logs',
    handler: 'healOrphanedLogs',
    ids: [],
    call: (c) => c.healOrphanedLogs(),
    verify: (_m, result) =>
      expect(result).toStrictEqual({ scanned: 0, healed: 0 }),
  },
  {
    id: 'logs.start',
    method: 'POST',
    path: 'logs/start',
    handler: 'start',
    ids: [],
    call: (c, req) =>
      c.start(USER, { project_id: PROJECT, task_id: null }, req),
    verify: rowVerify('start', (req) => [
      ME,
      { project_id: PROJECT, task_id: null },
      { purpose: 'alias', native: nativeOf(req) },
    ]),
  },
  {
    id: 'logs.manual',
    method: 'POST',
    path: 'logs/manual',
    handler: 'manual',
    ids: [],
    call: (c, req) =>
      c.manual(
        USER,
        {
          project_id: PROJECT,
          task_id: TASK,
          started_at: '2026-09-02T01:00:00.000Z',
          ended_at: '2026-09-02T02:00:00.000Z',
          break_minutes: 15,
        },
        req,
      ),
    verify: rowVerify('createManual', (req) => [
      ME,
      {
        project_id: PROJECT,
        task_id: TASK,
        started_at: '2026-09-02T01:00:00.000Z',
        ended_at: '2026-09-02T02:00:00.000Z',
        break_minutes: 15,
      },
      { purpose: 'alias', native: nativeOf(req) },
    ]),
  },
  {
    id: 'logs.review_bulk',
    method: 'POST',
    path: 'logs/review-bulk',
    handler: 'reviewBulk',
    ids: [],
    call: (c, req) => c.reviewBulk(req),
    verify: () => undefined, // 410: asserted in its own block
  },
  {
    id: 'logs.stop',
    method: 'POST',
    path: 'logs/:logId/stop',
    handler: 'stop',
    ids: ['logId'],
    call: (c, req) =>
      c.stop(
        LOG,
        USER,
        { ended_at: '2026-09-02T02:00:00.000Z', break_minutes: 5 },
        req,
      ),
    verify: rowVerify('stop', (req) => [
      ME,
      LOG,
      {
        endedAt: '2026-09-02T02:00:00.000Z',
        breakMinutes: 5,
        alias: { native: nativeOf(req) },
      },
    ]),
  },
  {
    id: 'logs.pause',
    method: 'POST',
    path: 'logs/:logId/pause',
    handler: 'pause',
    ids: ['logId'],
    call: (c) => c.pause(LOG, USER),
    verify: rowVerify('pause', () => [ME, LOG]),
  },
  {
    id: 'logs.resume',
    method: 'POST',
    path: 'logs/:logId/resume',
    handler: 'resume',
    ids: ['logId'],
    call: (c) => c.resume(LOG, USER),
    verify: rowVerify('resume', () => [ME, LOG]),
  },
  {
    id: 'logs.review',
    method: 'POST',
    path: 'logs/:logId/review',
    handler: 'review',
    ids: [],
    call: (c, req) => c.review(req),
    verify: () => undefined, // 410: asserted in its own block
  },
  {
    id: 'logs.segments',
    method: 'GET',
    path: 'logs/:logId/segments',
    handler: 'listLogSegments',
    ids: ['logId'],
    call: (c) => c.listLogSegments(LOG, USER),
    verify: (m, result) => {
      expect(m.entries.listSegments).toHaveBeenCalledWith(ME, LOG);
      keysOf((result as unknown[])[0], SEGMENT_KEYS);
      expect((result as Array<{ log_id: string }>)[0].log_id).toBe(LOG);
    },
  },
  {
    id: 'logs.comments',
    method: 'GET',
    path: 'logs/:logId/comments',
    handler: 'listLogComments',
    ids: ['logId'],
    call: (c) => c.listLogComments(LOG, USER),
    verify: (m, result) => {
      expect(m.entries.listComments).toHaveBeenCalledWith(ME, LOG);
      keysOf((result as unknown[])[0], COMMENT_KEYS);
      expect((result as Array<{ author: unknown }>)[0].author).toMatchObject({
        display_name: 'Me',
        first_name: 'M',
        last_name: 'E',
        email: 'me@x.io',
      });
    },
  },
  {
    id: 'logs.comment_add',
    method: 'POST',
    path: 'logs/:logId/comments',
    handler: 'createLogComment',
    ids: ['logId'],
    call: (c) => c.createLogComment(LOG, USER, { body: '  Done  ' }),
    verify: (m, result) => {
      // The service trims and refuses an empty body with the old 400 copy.
      expect(m.entries.addComment).toHaveBeenCalledWith(ME, LOG, '  Done  ');
      keysOf(result, COMMENT_KEYS);
    },
  },
  {
    id: 'logs.update',
    method: 'PATCH',
    path: 'logs/:logId',
    handler: 'update',
    ids: ['logId'],
    call: (c, req) =>
      c.update(LOG, USER, { task_id: null, break_minutes: 10 }, req),
    verify: rowVerify('update', (req) => [
      ME,
      LOG,
      { task_id: null, break_minutes: 10 },
      { purpose: 'alias', native: nativeOf(req) },
    ]),
  },
  {
    id: 'logs.delete',
    method: 'DELETE',
    path: 'logs/:logId',
    handler: 'remove',
    ids: ['logId'],
    call: (c, req) => c.remove(LOG, USER, req),
    verify: (m, result, req) => {
      expect(m.entries.remove).toHaveBeenCalledWith(ME, LOG, {
        alias: true,
        native: nativeOf(req),
      });
      expect(result).toBeUndefined();
    },
  },
  {
    id: 'logs.running',
    method: 'GET',
    path: 'logs/me/running',
    handler: 'getMyRunningLog',
    ids: [],
    call: (c) => c.getMyRunningLog(USER),
    verify: (m, result) => {
      expect(m.entries.getRunning).toHaveBeenCalledWith(ME);
      expect(m.legacy.rows).toHaveBeenCalledWith([expect.any(Object)], {
        cost: true,
        write: true,
      });
      keysOf(result, ROW_KEYS);
      expect(result).toMatchObject({
        task: { title: 'Logo' },
        project: { title: 'Acme site' },
      });
    },
  },
  {
    id: 'logs.get',
    method: 'GET',
    path: 'logs/:logId',
    handler: 'getLog',
    ids: ['logId'],
    call: (c) => c.getLog(LOG, USER),
    verify: (m, result) => {
      // D34 + D49 live in entries.get (assertViewEntry); the row goes through the builder.
      expect(m.entries.get).toHaveBeenCalledWith(ME, LOG);
      expect(m.legacy.rows).toHaveBeenCalledWith([expect.any(Object)], {
        cost: true,
      });
      keysOf(result, ROW_KEYS);
    },
  },
  {
    id: 'teams.my',
    method: 'GET',
    path: 'teams/:teamId/my',
    handler: 'listMyTeamLogs',
    ids: ['teamId'],
    call: (c) => c.listMyTeamLogs(TEAM, USER, QUERY),
    verify: (m, result) => {
      expect(m.legacy.listTeamMine).toHaveBeenCalledWith(ME, TEAM, QUERY);
      keysOf(result, LIST_KEYS);
      keysOf((result as typeof LIST).items[0], ROW_KEYS);
    },
  },
  {
    id: 'teams.my_summary',
    method: 'GET',
    path: 'teams/:teamId/my/summary',
    handler: 'myTeamLogsSummary',
    ids: ['teamId'],
    call: (c) => c.myTeamLogsSummary(TEAM, USER, QUERY),
    verify: (m, result) => {
      expect(m.legacy.teamMineSummary).toHaveBeenCalledWith(ME, TEAM, QUERY);
      keysOf(result, SUMMARY_KEYS);
    },
  },
  {
    id: 'teams.my_rate',
    method: 'GET',
    path: 'teams/:teamId/projects/:projectId/my-rate',
    handler: 'myProjectRate',
    ids: ['teamId', 'projectId'],
    call: (c) => c.myProjectRate(TEAM, PROJECT),
    verify: (_m, result) => expect(result).toBeNull(),
  },
  {
    id: 'teams.tasks',
    method: 'GET',
    path: 'teams/:teamId/projects/:projectId/tasks',
    handler: 'listTeamProjectTasks',
    ids: ['teamId', 'projectId'],
    call: (c) => c.listTeamProjectTasks(TEAM, PROJECT, USER),
    verify: (m, result) => {
      expect(m.legacy.teamTasks).toHaveBeenCalledWith(ME, TEAM, PROJECT);
      keysOf((result as unknown[])[0], TASK_KEYS);
    },
  },
  {
    id: 'teams.logs',
    method: 'GET',
    path: 'teams/:teamId/logs',
    handler: 'listTeamLogs',
    ids: ['teamId'],
    call: (c) => c.listTeamLogs(TEAM, USER, QUERY),
    verify: (m, result) => {
      expect(m.legacy.listTeam).toHaveBeenCalledWith(ME, TEAM, QUERY);
      keysOf(result, LIST_KEYS);
    },
  },
  {
    id: 'teams.logs_summary',
    method: 'GET',
    path: 'teams/:teamId/logs/summary',
    handler: 'teamLogsSummary',
    ids: ['teamId'],
    call: (c) => c.teamLogsSummary(TEAM, USER, QUERY),
    verify: (m, result) => {
      expect(m.legacy.teamSummary).toHaveBeenCalledWith(ME, TEAM, QUERY);
      keysOf(result, SUMMARY_KEYS);
    },
  },
  {
    id: 'teams.projects',
    method: 'GET',
    path: 'teams/:teamId/projects',
    handler: 'listTeamLogProjects',
    ids: ['teamId'],
    call: (c) => c.listTeamLogProjects(TEAM, USER),
    verify: (m, result) => {
      expect(m.legacy.teamProjects).toHaveBeenCalledWith(ME, TEAM);
      keysOf((result as unknown[])[0], ['id', 'title']);
    },
  },
  {
    id: 'teams.members',
    method: 'GET',
    path: 'teams/:teamId/members',
    handler: 'listTeamLogMembers',
    ids: ['teamId'],
    call: (c) => c.listTeamLogMembers(TEAM, USER),
    verify: (m, result) => {
      expect(m.legacy.teamMembers).toHaveBeenCalledWith(ME, TEAM);
      keysOf((result as unknown[])[0], ['id', 'display_name']);
    },
  },
  {
    id: 'projects.contract_status',
    method: 'GET',
    path: 'projects/:projectId/contract-status',
    handler: 'getProjectContractStatus',
    ids: ['projectId'],
    call: (c) => c.getProjectContractStatus(PROJECT, USER),
    verify: (m, result) => {
      expect(m.legacy.contractStatus).toHaveBeenCalledWith(ME, PROJECT);
      expect(result).toStrictEqual({
        enforcement: 'off',
        engagement_status: 'engaged',
      });
    },
  },
  {
    id: 'projects.my',
    method: 'GET',
    path: 'projects/:projectId/my',
    handler: 'listMyProjectLogs',
    ids: ['projectId'],
    call: (c) => c.listMyProjectLogs(PROJECT, USER, QUERY),
    verify: (m, result) => {
      expect(m.legacy.listProjectMine).toHaveBeenCalledWith(ME, PROJECT, QUERY);
      keysOf(result, LIST_KEYS);
    },
  },
  {
    id: 'projects.my_summary',
    method: 'GET',
    path: 'projects/:projectId/my/summary',
    handler: 'myProjectLogsSummary',
    ids: ['projectId'],
    call: (c) => c.myProjectLogsSummary(PROJECT, USER, QUERY),
    verify: (m, result) => {
      expect(m.legacy.projectMineSummary).toHaveBeenCalledWith(
        ME,
        PROJECT,
        QUERY,
      );
      keysOf(result, SUMMARY_KEYS);
    },
  },
  {
    id: 'projects.logs',
    method: 'GET',
    path: 'projects/:projectId/logs',
    handler: 'listProjectLogs',
    ids: ['projectId'],
    call: (c) => c.listProjectLogs(PROJECT, USER, QUERY),
    verify: (m, result) => {
      expect(m.legacy.listProject).toHaveBeenCalledWith(ME, PROJECT, QUERY);
      keysOf(result, LIST_KEYS);
    },
  },
  {
    id: 'projects.logs_summary',
    method: 'GET',
    path: 'projects/:projectId/logs/summary',
    handler: 'projectLogsSummary',
    ids: ['projectId'],
    call: (c) => c.projectLogsSummary(PROJECT, USER, QUERY),
    verify: (m, result) => {
      expect(m.legacy.projectSummary).toHaveBeenCalledWith(ME, PROJECT, QUERY);
      keysOf(result, SUMMARY_KEYS);
    },
  },
  {
    id: 'projects.members',
    method: 'GET',
    path: 'projects/:projectId/members',
    handler: 'listProjectLogMembers',
    ids: ['projectId'],
    call: (c) => c.listProjectLogMembers(PROJECT, USER),
    verify: (m, result) => {
      expect(m.legacy.projectMembers).toHaveBeenCalledWith(ME, PROJECT);
      keysOf((result as unknown[])[0], ['id', 'display_name']);
      expect((result as unknown[])[0]).not.toHaveProperty('email');
    },
  },
  {
    id: 'projects.tasks',
    method: 'GET',
    path: 'projects/:projectId/tasks',
    handler: 'listProjectTasks',
    ids: ['projectId'],
    call: (c) => c.listProjectTasks(PROJECT, USER),
    verify: (m, result) => {
      expect(m.entries.workItems).toHaveBeenCalledWith(ME, PROJECT);
      expect(result).toEqual([TASK_OPTION]);
      keysOf((result as unknown[])[0], TASK_KEYS);
    },
  },
];

/** Every `/api/team-time` call in web/src/services/team-time.service.ts (feat/time-rebuild), as METHOD path. */
const WEB_CALLS = [
  'POST logs/start',
  'POST logs/:logId/stop',
  'POST logs/:logId/pause',
  'POST logs/:logId/resume',
  'PATCH logs/:logId',
  'DELETE logs/:logId',
  'POST logs/manual',
  'GET logs/:logId',
  'GET logs/me/running',
  'POST logs/:logId/review',
  'POST logs/review-bulk',
  'GET logs/:logId/segments',
  'GET logs/:logId/comments',
  'POST logs/:logId/comments',
  'GET teams/:teamId/my',
  'GET teams/:teamId/projects/:projectId/my-rate',
  'GET teams/:teamId/projects/:projectId/tasks',
  'GET projects/:projectId/tasks',
  'GET teams/:teamId/logs',
  'GET teams/:teamId/logs/summary',
  'GET teams/:teamId/my/summary',
  'GET projects/:projectId/my',
  'GET projects/:projectId/my/summary',
  'GET projects/:projectId/logs',
  'GET projects/:projectId/logs/summary',
  'GET projects/:projectId/members',
  'GET teams/:teamId/projects',
  'GET teams/:teamId/members',
  'GET projects/:projectId/contract-status',
];

const handlerOf = (name: Handler) =>
  TeamTimeLegacyController.prototype[name] as unknown as object;

// ── Route metadata ────────────────────────────────────────────────────────────────────────────────────────────

describe('TeamTimeLegacyController routes', () => {
  it('serves all 30 routes: the 29 web calls plus the heal cron, each with a unique route id', () => {
    expect(ROUTES).toHaveLength(30);
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(30);
    const served = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
    expect(WEB_CALLS).toHaveLength(29);
    for (const call of WEB_CALLS) expect(served).toContain(call);
    expect(
      ROUTES.filter((r) => !WEB_CALLS.includes(`${r.method} ${r.path}`)).map(
        (r) => r.id,
      ),
    ).toEqual(['cron.heal']);
  });

  it('class: /team-time, SupabaseAuthGuard + TimeGuestGuard, the telemetry interceptor (no entitlement guard)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, TeamTimeLegacyController)).toBe(
      'team-time',
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, TeamTimeLegacyController),
    ).toEqual([SupabaseAuthGuard, TimeGuestGuard]);
    expect(
      Reflect.getMetadata(INTERCEPTORS_METADATA, TeamTimeLegacyController),
    ).toEqual([AliasTelemetryInterceptor]);
  });

  for (const r of ROUTES) {
    it(`${r.id}: ${r.method} ${r.path} → ${r.handler}`, () => {
      const handler = handlerOf(r.handler);
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(r.path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
        RequestMethod[r.method],
      );
      expect(Reflect.getMetadata(ALIAS_ROUTE_KEY, handler)).toBe(r.id);
    });
  }

  it('keeps the old declaration order (logs/me/running before GET logs/:logId)', () => {
    const declared = Object.getOwnPropertyNames(
      TeamTimeLegacyController.prototype,
    ).filter(
      (name) =>
        name !== 'constructor' &&
        Reflect.getMetadata(PATH_METADATA, handlerOf(name as Handler)) !==
          undefined,
    );
    expect(declared).toEqual(ROUTES.map((r) => r.handler));
    expect(declared.indexOf('getMyRunningLog')).toBeLessThan(
      declared.indexOf('getLog'),
    );
  });

  it('status codes: POSTs keep the default 201, heal is 200 (@HttpCode only there)', () => {
    for (const r of ROUTES) {
      const code = Reflect.getMetadata(
        HTTP_CODE_METADATA,
        handlerOf(r.handler),
      );
      expect(code).toBe(r.id === 'cron.heal' ? 200 : undefined);
    }
  });

  it('heal is @Public with CronSecretGuard; nothing else is public', () => {
    for (const r of ROUTES) {
      const handler = handlerOf(r.handler);
      if (r.id === 'cron.heal') {
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
          CronSecretGuard,
        ]);
      } else {
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
      }
    }
  });

  it('only logs/me/running answers guests (D08)', () => {
    for (const r of ROUTES) {
      expect(
        Reflect.getMetadata(TIME_GUEST_EMPTY_SHAPE, handlerOf(r.handler)),
      ).toBe(r.id === 'logs.running' ? true : undefined);
    }
  });

  it('every :logId/:teamId/:projectId is ParseUUIDPipe with 404 (CC13)', async () => {
    for (const r of ROUTES) {
      const args = (Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        TeamTimeLegacyController,
        r.handler,
      ) ?? {}) as Record<
        string,
        { index: number; data?: string; pipes: unknown[] }
      >;
      const params = Object.entries(args)
        .filter(([key]) => key.startsWith(`${RouteParamtypes.PARAM}:`))
        .map(([, v]) => v);
      expect(params.map((p) => p.data).sort()).toEqual([...r.ids].sort());
      for (const p of params) {
        const pipe = p.pipes[0] as ParseUUIDPipe;
        expect(pipe).toBeInstanceOf(ParseUUIDPipe);
        await expect(
          pipe.transform('not-a-uuid', { type: 'param', data: p.data }),
        ).rejects.toBeInstanceOf(NotFoundException);
      }
    }
  });

  it('the two 410 handlers take no @Body() (R7)', () => {
    for (const handler of ['reviewBulk', 'review'] as const) {
      const args = (Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        TeamTimeLegacyController,
        handler,
      ) ?? {}) as Record<string, unknown>;
      expect(
        Object.keys(args).some((k) => k.startsWith(`${RouteParamtypes.BODY}:`)),
      ).toBe(false);
    }
  });
});

// ── Delegation and response shapes, both origins ──────────────────────────────────────────────────────────────

describe('TeamTimeLegacyController delegation', () => {
  for (const origin of [WEB_ORIGIN, 'capacitor://localhost']) {
    for (const r of ROUTES.filter(
      (route) => !['logs.review_bulk', 'logs.review'].includes(route.id),
    )) {
      it(`${r.id} (${origin})`, async () => {
        const m = mocks();
        const controller = new TeamTimeLegacyController(
          m.entries as unknown as TimeEntriesService,
          m.legacy as unknown as TeamTimeLegacyService,
        );
        const req = reqWith(origin);
        const result = await r.call(controller, req);
        r.verify(m, result, req);
      });
    }
  }

  it('writes always pass purpose alias; the web origin is never native', async () => {
    const m = mocks();
    const c = new TeamTimeLegacyController(
      m.entries as unknown as TimeEntriesService,
      m.legacy as unknown as TeamTimeLegacyService,
    );
    // https://localhost:3000 is a dev web origin, not the Android shell.
    await c.start(
      USER,
      { project_id: PROJECT },
      reqWith('https://localhost:3000'),
    );
    await c.manual(
      USER,
      {
        project_id: PROJECT,
        started_at: '2026-09-02T01:00:00.000Z',
        ended_at: '2026-09-02T02:00:00.000Z',
      },
      reqWith('https://localhost'),
    );
    await c.update(LOG, USER, {}, reqWith());
    expect(m.entries.start).toHaveBeenCalledWith(
      ME,
      { project_id: PROJECT, task_id: null },
      { purpose: 'alias', native: false },
    );
    expect(m.entries.createManual).toHaveBeenCalledWith(
      ME,
      {
        project_id: PROJECT,
        task_id: null,
        started_at: '2026-09-02T01:00:00.000Z',
        ended_at: '2026-09-02T02:00:00.000Z',
      },
      { purpose: 'alias', native: true },
    );
    expect(m.entries.update).toHaveBeenCalledWith(
      ME,
      LOG,
      {},
      { purpose: 'alias', native: false },
    );
  });

  it('a stop without options sends only the alias context', async () => {
    const m = mocks();
    const c = new TeamTimeLegacyController(
      m.entries as unknown as TimeEntriesService,
      m.legacy as unknown as TeamTimeLegacyService,
    );
    await c.stop(LOG, USER, {}, reqWith(WEB_ORIGIN));
    expect(m.entries.stop).toHaveBeenCalledWith(ME, LOG, {
      alias: { native: false },
    });
  });

  it('write responses carry status, reviewed_* and limit_context from the Row builder', async () => {
    const m = mocks();
    const cap = {
      over_limit: true,
      limit_window: 'weekly' as const,
      limit_hours: 40,
      logged_hours_in_window: 40.5,
      overtime_requires_approval: true,
      window_start: '2026-08-31',
      window_end: '2026-09-06',
    };
    m.legacy.rows.mockImplementation((views: TimeEntryView[]) =>
      Promise.resolve(
        views.map((v) =>
          toLegacyLog(v, {
            cost: true,
            limitContext: cap,
            review: {
              id: v.id,
              legacy_reviewed_by: TEAM,
              legacy_reviewed_at: '2026-08-01T00:00:00.000Z',
              legacy_review_note: 'ok',
              legacy_reviewer: {
                id: TEAM,
                display_name: 'Admin',
                avatar_url: null,
              },
            },
          }),
        ),
      ),
    );
    const c = new TeamTimeLegacyController(
      m.entries as unknown as TimeEntriesService,
      m.legacy as unknown as TeamTimeLegacyService,
    );
    for (const result of [
      await c.start(USER, { project_id: PROJECT }, reqWith()),
      await c.manual(
        USER,
        {
          project_id: PROJECT,
          started_at: '2026-09-02T01:00:00.000Z',
          ended_at: '2026-09-02T02:00:00.000Z',
        },
        reqWith(),
      ),
      await c.stop(LOG, USER, {}, reqWith()),
      await c.pause(LOG, USER),
      await c.resume(LOG, USER),
      await c.update(
        LOG,
        USER,
        { started_at: '2026-09-02T00:00:00.000Z' },
        reqWith(),
      ),
    ]) {
      expect(result).toMatchObject({
        status: 'pending',
        reviewed_by: TEAM,
        reviewed_at: '2026-08-01T00:00:00.000Z',
        review_note: 'ok',
        reviewer: { display_name: 'Admin' },
        limit_context: cap,
      });
    }
  });

  it('logs/me/running: a guest gets null without any read; no timer is null', async () => {
    const m = mocks();
    const c = new TeamTimeLegacyController(
      m.entries as unknown as TimeEntriesService,
      m.legacy as unknown as TeamTimeLegacyService,
    );
    expect(await c.getMyRunningLog(GUEST)).toBeNull();
    expect(m.entries.getRunning).not.toHaveBeenCalled();
    m.entries.getRunning.mockResolvedValue(null);
    expect(await c.getMyRunningLog(USER)).toBeNull();
    expect(m.legacy.rows).not.toHaveBeenCalled();
  });

  it('per-log review is 410 TIMESHEETS_REPLACED_REVIEW with origin-aware copy (D06)', () => {
    const m = mocks();
    const c = new TeamTimeLegacyController(
      m.entries as unknown as TimeEntriesService,
      m.legacy as unknown as TeamTimeLegacyService,
    );
    const cases: Array<[string | undefined, boolean]> = [
      [WEB_ORIGIN, false],
      [undefined, false],
      ['https://localhost:3000', false],
      ['capacitor://localhost', true],
      ['https://localhost', true],
    ];
    for (const [origin, native] of cases) {
      for (const call of [
        () => c.reviewBulk(reqWith(origin)),
        () => c.review(reqWith(origin)),
      ]) {
        let thrown: unknown;
        try {
          call();
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toMatchObject({ status: 410 });
        expect(
          (thrown as { getResponse(): unknown }).getResponse(),
        ).toStrictEqual({
          code: 'TIMESHEETS_REPLACED_REVIEW',
          message: ALIAS_REVIEW_GONE_MESSAGE(native),
        });
      }
    }
    expect(ALIAS_REVIEW_GONE_MESSAGE(false)).toBe(
      'Approvals now happen by timesheet. Reload Proyekto.',
    );
    expect(ALIAS_REVIEW_GONE_MESSAGE(true)).toBe(
      'Update the app to approve timesheets.',
    );
    for (const fn of Object.values(m.entries)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

// ── Over HTTP: the global pipeline, guards, pipes and error envelope ──────────────────────────────────────────

/** SupabaseAuthGuard stand-in: `x-user` signs in, `x-guest: 1` makes a guest; public routes pass. */
class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const id = req.headers['x-user'];
    if (typeof id === 'string') {
      req.user = { id, is_guest: req.headers['x-guest'] === '1' };
      return true;
    }
    if (Reflect.getMetadata(IS_PUBLIC_KEY, ctx.getHandler())) return true;
    throw new UnauthorizedException();
  }
}
class FakeCronGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.headers['x-cron-secret'] === 'shh') return true;
    throw new UnauthorizedException('Invalid cron secret.');
  }
}

describe('TeamTimeLegacyController over HTTP', () => {
  let app: INestApplication<App>;
  let m: Mocks;
  let telemetry: AliasTelemetryInterceptor;
  const cache = { flushAliasHits: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    m = mocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [TeamTimeLegacyController],
      providers: [
        { provide: TimeEntriesService, useValue: m.entries },
        { provide: TeamTimeLegacyService, useValue: m.legacy },
        { provide: TimeCacheService, useValue: cache },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue(new FakeAuthGuard())
      .overrideGuard(CronSecretGuard)
      .useValue(new FakeCronGuard())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
    await app.init();
    telemetry = app.get(AliasTelemetryInterceptor);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const hits = (route: string) =>
    telemetry
      .pending()
      .filter((h) => h.routeId === route)
      .reduce((n, h) => n + h.count, 0);

  it('review-bulk with an old body: 410 envelope, web and native copy, counted', async () => {
    const before = hits('logs.review_bulk');
    const web = await http()
      .post(`${ALIAS}/logs/review-bulk`)
      .set('x-user', ME)
      .set('Origin', WEB_ORIGIN)
      .send({ log_ids: [LOG], decision: 'approved', reason: 'ok' })
      .expect(410);
    expect(web.body.error).toMatchObject({
      code: 'TIMESHEETS_REPLACED_REVIEW',
      message: 'Approvals now happen by timesheet. Reload Proyekto.',
      status: 410,
    });
    const native = await http()
      .post(`${ALIAS}/logs/${LOG}/review`)
      .set('x-user', ME)
      .set('Origin', 'capacitor://localhost')
      .send({ decision: 'rejected' })
      .expect(410);
    expect(native.body.error.message).toBe(
      'Update the app to approve timesheets.',
    );
    await http()
      .post(`${ALIAS}/logs/not-a-uuid/review`)
      .set('x-user', ME)
      .expect(410);
    expect(hits('logs.review_bulk')).toBe(before + 1);
  });

  it('start: 201 with the Row in { data }; an old empty task_id is no task', async () => {
    m.entries.start.mockClear();
    const res = await http()
      .post(`${ALIAS}/logs/start`)
      .set('x-user', ME)
      .send({ project_id: PROJECT, task_id: '' })
      .expect(201);
    expect(m.entries.start).toHaveBeenCalledWith(
      ME,
      { project_id: PROJECT, task_id: null },
      { purpose: 'alias', native: false },
    );
    keysOf(res.body.data, ROW_KEYS);
  });

  it('a second running timer is 400 RUNNING_TIMER_MESSAGE (D07)', async () => {
    m.entries.start.mockImplementationOnce(
      (_u: string, _i: unknown, o: { native: boolean }) =>
        Promise.resolve().then(() =>
          throwTimeDb(
            {
              code: '23505',
              message:
                'duplicate key value violates unique constraint "uq_time_entries_one_running_per_member"',
            },
            { alias: { native: o.native } },
          ),
        ),
    );
    const res = await http()
      .post(`${ALIAS}/logs/start`)
      .set('x-user', ME)
      .send({ project_id: PROJECT })
      .expect(400);
    expect(res.body.error.message).toBe(RUNNING_TIMER_MESSAGE);
  });

  it('an edit in a submitted week is 409 TIMESHEET_LOCKED with the alias copy, per origin (D06)', async () => {
    const locked = (
      _u: string,
      _id: string,
      _i: unknown,
      o: { native: boolean },
    ) =>
      Promise.resolve().then(() =>
        throwTimeDb(
          {
            code: 'P0001',
            message: 'TIME_ENTRY_LOCKED',
            details: JSON.stringify({
              reason: 'sheet_submitted',
              entry_id: LOG,
            }),
          },
          { alias: { native: o.native } },
        ),
      );
    m.entries.update
      .mockImplementationOnce(locked)
      .mockImplementationOnce(locked);
    const web = await http()
      .patch(`${ALIAS}/logs/${LOG}`)
      .set('x-user', ME)
      .set('Origin', WEB_ORIGIN)
      .send({ break_minutes: 5 })
      .expect(409);
    expect(web.body.error).toMatchObject({
      code: 'TIMESHEET_LOCKED',
      message: ALIAS_LOCKED_MESSAGE(false),
      reason: 'entry',
    });
    expect(web.body.error.message).toBe(
      "This week was sent for approval, so it can't be changed here. Reload Proyekto to see timesheets.",
    );
    const native = await http()
      .patch(`${ALIAS}/logs/${LOG}`)
      .set('x-user', ME)
      .set('Origin', 'https://localhost')
      .send({ break_minutes: 5 })
      .expect(409);
    expect(native.body.error.message).toBe(ALIAS_LOCKED_MESSAGE(true));
  });

  it('logs/me/running is not swallowed by logs/:logId; guests get 200 null', async () => {
    m.entries.get.mockClear();
    const own = await http()
      .get(`${ALIAS}/logs/me/running`)
      .set('x-user', ME)
      .expect(200);
    expect(own.body.data).toMatchObject({ id: LOG, status: 'pending' });
    expect(m.entries.get).not.toHaveBeenCalled();
    const guest = await http()
      .get(`${ALIAS}/logs/me/running`)
      .set('x-user', 'guest-1')
      .set('x-guest', '1')
      .expect(200);
    expect(guest.body).toEqual({ data: null });
  });

  it('guests 404 on every other route, and a guard 404 is not counted', async () => {
    const before = hits('logs.get');
    const res = await http()
      .get(`${ALIAS}/logs/${LOG}`)
      .set('x-user', 'guest-1')
      .set('x-guest', '1')
      .expect(404);
    expect(res.body.error.code).toBe('TIME_NOT_FOUND');
    await http()
      .post(`${ALIAS}/logs/review-bulk`)
      .set('x-user', 'guest-1')
      .set('x-guest', '1')
      .expect(404);
    expect(hits('logs.get')).toBe(before);
  });

  it('a malformed id is 404 before the service (CC13), and the hit still counts', async () => {
    m.entries.get.mockClear();
    const before = hits('logs.get');
    await http().get(`${ALIAS}/logs/not-a-uuid`).set('x-user', ME).expect(404);
    await http().get(`${ALIAS}/teams/nope/logs`).set('x-user', ME).expect(404);
    expect(m.entries.get).not.toHaveBeenCalled();
    expect(hits('logs.get')).toBe(before + 1);
  });

  it('DELETE answers 200; PATCH 200; old list queries validate (limit ≤ 200)', async () => {
    await http().delete(`${ALIAS}/logs/${LOG}`).set('x-user', ME).expect(200);
    await http()
      .patch(`${ALIAS}/logs/${LOG}`)
      .set('x-user', ME)
      .send({ task_id: TASK })
      .expect(200);
    await http()
      .get(`${ALIAS}/teams/${TEAM}/logs?status=approved&page=2&limit=200`)
      .set('x-user', ME)
      .expect(200);
    expect(m.legacy.listTeam).toHaveBeenLastCalledWith(
      ME,
      TEAM,
      expect.objectContaining({ status: 'approved', page: 2, limit: 200 }),
    );
    await http()
      .get(`${ALIAS}/teams/${TEAM}/logs?limit=201`)
      .set('x-user', ME)
      .expect(400);
  });

  it('contract-status and heal answer their exact shapes', async () => {
    const status = await http()
      .get(`${ALIAS}/projects/${PROJECT}/contract-status`)
      .set('x-user', ME)
      .expect(200);
    expect(status.body).toEqual({
      data: { enforcement: 'off', engagement_status: 'engaged' },
    });
    const heal = await http()
      .post(`${ALIAS}/cron/heal-orphaned-logs`)
      .set('x-cron-secret', 'shh')
      .expect(200);
    expect(heal.body).toEqual({ data: { scanned: 0, healed: 0 } });
    await http().post(`${ALIAS}/cron/heal-orphaned-logs`).expect(401);
  });
});

// ── Telemetry (D30) ───────────────────────────────────────────────────────────────────────────────────────────

describe('AliasTelemetryInterceptor', () => {
  interface FakePipeline {
    ops: unknown[][];
    incrby: jest.Mock;
    expire: jest.Mock;
    exec: jest.Mock;
  }
  function fakeRedis(o: { failExec?: boolean } = {}) {
    const pipelines: FakePipeline[] = [];
    const raw = {
      pipeline: jest.fn((): FakePipeline => {
        const ops: unknown[][] = [];
        const pipeline: FakePipeline = {
          ops,
          incrby: jest.fn(),
          expire: jest.fn(),
          exec: o.failExec
            ? jest.fn().mockRejectedValue(new Error('upstash down'))
            : jest.fn().mockResolvedValue([]),
        };
        pipeline.incrby.mockImplementation((key: string, n: number) => {
          ops.push(['incrby', key, n]);
          return pipeline;
        });
        pipeline.expire.mockImplementation((key: string, secs: number) => {
          ops.push(['expire', key, secs]);
          return pipeline;
        });
        pipelines.push(pipeline);
        return pipeline;
      }),
      incr: jest.fn(),
    };
    return { redis: raw as unknown as Redis, raw, pipelines };
  }

  function contextFor(handler: Handler): ExecutionContext {
    return {
      getHandler: () => handlerOf(handler),
      getClass: () => TeamTimeLegacyController,
    } as unknown as ExecutionContext;
  }
  const nextHandler = () => ({ handle: jest.fn(() => ({}) as never) });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-05T08:00:00.000Z'));
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('counts in process before the handler; no Redis command per hit', () => {
    const { redis, raw } = fakeRedis();
    const next = nextHandler();
    const t = new AliasTelemetryInterceptor(
      new Reflector(),
      new TimeCacheService(redis),
    );
    t.intercept(contextFor('getMyRunningLog'), next);
    t.intercept(contextFor('getMyRunningLog'), next);
    t.intercept(contextFor('start'), next);
    expect(next.handle).toHaveBeenCalledTimes(3);
    expect(t.pending()).toEqual([
      { routeId: 'logs.running', day: '20261005', count: 2 },
      { routeId: 'logs.start', day: '20261005', count: 1 },
    ]);
    expect(raw.pipeline).not.toHaveBeenCalled();
    expect(raw.incr).not.toHaveBeenCalled();
  });

  it('flushes once a minute: one pipeline of INCRBY n + EXPIRE per key, one log line per route', () => {
    const { redis, raw, pipelines } = fakeRedis();
    const log = jest.spyOn(Logger.prototype, 'log');
    const t = new AliasTelemetryInterceptor(
      new Reflector(),
      new TimeCacheService(redis),
    );
    for (let i = 0; i < 20; i++) t.record('logs.running');
    t.record('logs.start');
    jest.advanceTimersByTime(ALIAS_FLUSH_INTERVAL_MS - 1);
    expect(raw.pipeline).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(raw.pipeline).toHaveBeenCalledTimes(1);
    expect(pipelines[0].ops).toEqual([
      ['incrby', 'time:alias:hits:logs.running:20261005', 20],
      [
        'expire',
        'time:alias:hits:logs.running:20261005',
        ALIAS_HITS_TTL_SECONDS,
      ],
      ['incrby', 'time:alias:hits:logs.start:20261005', 1],
      ['expire', 'time:alias:hits:logs.start:20261005', ALIAS_HITS_TTL_SECONDS],
    ]);
    expect(ALIAS_HITS_TTL_SECONDS).toBe(3_456_000);
    expect(pipelines[0].exec).toHaveBeenCalledTimes(1);
    const lines = log.mock.calls.map(
      (c) => JSON.parse(String(c[0])) as unknown,
    );
    expect(lines).toEqual([
      { evt: 'team_time_alias', route: 'logs.running', count_since_last: 20 },
      { evt: 'team_time_alias', route: 'logs.start', count_since_last: 1 },
    ]);
    expect(t.pending()).toEqual([]);

    // An idle minute sends nothing.
    jest.advanceTimersByTime(ALIAS_FLUSH_INTERVAL_MS);
    expect(raw.pipeline).toHaveBeenCalledTimes(1);
  });

  it('keys by UTC day: hits on both sides of midnight are two keys', async () => {
    const { redis, pipelines } = fakeRedis();
    const t = new AliasTelemetryInterceptor(
      new Reflector(),
      new TimeCacheService(redis),
    );
    t.record('teams.logs', new Date('2026-10-05T23:59:59.000Z'));
    t.record('teams.logs', new Date('2026-10-06T00:00:01.000Z'));
    await t.flush();
    expect(pipelines[0].ops.filter((o) => o[0] === 'incrby')).toEqual([
      ['incrby', 'time:alias:hits:teams.logs:20261005', 1],
      ['incrby', 'time:alias:hits:teams.logs:20261006', 1],
    ]);
  });

  it('survives a null Redis and a failing Redis', async () => {
    const nullRedis = new AliasTelemetryInterceptor(
      new Reflector(),
      new TimeCacheService(null),
    );
    nullRedis.record('logs.start');
    await expect(nullRedis.flush()).resolves.toBeUndefined();
    expect(nullRedis.pending()).toEqual([]);

    const { redis, pipelines } = fakeRedis({ failExec: true });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const failing = new AliasTelemetryInterceptor(
      new Reflector(),
      new TimeCacheService(redis),
    );
    failing.record('logs.start');
    await expect(failing.flush()).resolves.toBeUndefined();
    expect(pipelines[0].exec).toHaveBeenCalledTimes(1);
    expect(failing.pending()).toEqual([]);
  });

  it('flushes what is left at shutdown and stops its timer', async () => {
    const { redis, raw } = fakeRedis();
    const t = new AliasTelemetryInterceptor(
      new Reflector(),
      new TimeCacheService(redis),
    );
    t.record('logs.stop');
    await t.onApplicationShutdown();
    expect(raw.pipeline).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(ALIAS_FLUSH_INTERVAL_MS * 3);
    expect(raw.pipeline).toHaveBeenCalledTimes(1);
    // Nothing buffered: shutdown sends nothing.
    await new AliasTelemetryInterceptor(
      new Reflector(),
      new TimeCacheService(redis),
    ).onApplicationShutdown();
    expect(raw.pipeline).toHaveBeenCalledTimes(1);
  });

  it('a handler without a route id is not counted', () => {
    const t = new AliasTelemetryInterceptor(
      new Reflector(),
      new TimeCacheService(null),
    );
    t.intercept(
      {
        getHandler: () => function plain() {},
        getClass: () => TeamTimeLegacyController,
      } as unknown as ExecutionContext,
      nextHandler(),
    );
    expect(t.pending()).toEqual([]);
  });
});
