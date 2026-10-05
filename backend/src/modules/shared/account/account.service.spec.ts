import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RevokedUsersService } from '../../../common/auth/revoked-users.service';
import type { RedisCacheInvalidationService } from '../../../common/cache/redis-cache-invalidation.service';
import type { RedisDataCacheService } from '../../../common/cache/redis-data-cache.service';
import type { TimeAuthorityService } from '../../execution/time/time-authority.service';
import { TIMESHEET_SELECT } from '../../execution/time/time-entry.select';
import type { TimeNotificationsService } from '../../execution/time/time-notifications.service';
import type { AccountReauthService } from './account-reauth.service';
import type { AccountStorageService } from './account-storage.service';
import { AccountService } from './account.service';
import type { DeleteAccountDto } from './dto/account-deletion.dto';

const USER = 'user-1';
const EMAIL = 'someone@example.com';

function validDto(overrides: Partial<DeleteAccountDto> = {}): DeleteAccountDto {
  return {
    confirmation: 'delete my account',
    password: 'hunter2',
    containers: [],
    ...overrides,
  } as DeleteAccountDto;
}

/** The timesheets read of the D54 step: records its filters, answers `result`. */
function timesheetsQuery(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const q: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'not', 'order']) {
    q[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return q;
    };
  }
  q.then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return { q, calls };
}

function build(
  opts: {
    rpcError?: string;
    verify?: jest.Mock;
    sweep?: jest.Mock;
    revoke?: jest.Mock;
    /** Wire the time services (D54); omitted, the harness has none, as before. */
    time?: {
      sheets?: { data: unknown; error: unknown };
      approversFor?: jest.Mock;
      sheetSubmitted?: jest.Mock;
    };
  } = {},
) {
  const rpc = jest.fn().mockResolvedValue(
    opts.rpcError
      ? { data: null, error: { message: opts.rpcError } }
      : {
          data: { deleted: true, summary: { deleted_projects: 2 } },
          error: null,
        },
  );
  const update = jest
    .fn()
    .mockReturnValue({ eq: jest.fn().mockResolvedValue({}) });
  const sheets = timesheetsQuery(
    opts.time?.sheets ?? { data: [], error: null },
  );
  const from = jest.fn((table: string) =>
    table === 'timesheets' ? sheets.q : { update },
  );
  const supabase = { rpc, from } as unknown as SupabaseClient;

  const verify = opts.verify ?? jest.fn().mockResolvedValue(undefined);
  const reauth = { verify } as unknown as AccountReauthService;

  const sweep =
    opts.sweep ?? jest.fn().mockResolvedValue({ status: 'done', deleted: 3 });
  const storage = { sweepUser: sweep } as unknown as AccountStorageService;

  const revoke = opts.revoke ?? jest.fn().mockResolvedValue(undefined);
  const revokedUsers = { revoke } as unknown as RevokedUsersService;

  const cache = {
    del: jest.fn().mockResolvedValue(undefined),
  } as unknown as RedisDataCacheService;
  const cacheInvalidation = {
    invalidateDiscoveryCaches: jest.fn().mockResolvedValue(undefined),
    invalidateDashboardCacheForUser: jest.fn().mockResolvedValue(undefined),
  } as unknown as RedisCacheInvalidationService;

  const approversFor =
    opts.time?.approversFor ?? jest.fn().mockResolvedValue(['decider-1']);
  const sheetSubmitted =
    opts.time?.sheetSubmitted ?? jest.fn().mockResolvedValue(undefined);
  const timeNotifications = opts.time
    ? ({ sheetSubmitted } as unknown as TimeNotificationsService)
    : undefined;
  const timeAuthority = opts.time
    ? ({ approversFor } as unknown as TimeAuthorityService)
    : undefined;

  const service = new AccountService(
    supabase,
    reauth,
    storage,
    revokedUsers,
    cache,
    cacheInvalidation,
    timeNotifications,
    timeAuthority,
  );
  return {
    service,
    rpc,
    from,
    verify,
    sweep,
    revoke,
    cacheInvalidation,
    sheetCalls: sheets.calls,
    approversFor,
    sheetSubmitted,
  };
}

/** A sheet delete_account just submitted for the deleted member. */
function onDeletionSheet(id: string) {
  return {
    id,
    member_user_id: USER,
    member_display_name_snapshot: 'Deleted user',
    scope_kind: 'team',
    scope_ref: 'team-1',
    team_id: 'team-1',
    workspace_id: 'ws-1',
    engagement_id: null,
    scope_label_snapshot: 'Acme Team',
    policy_workspace_id: 'ws-1',
    period_kind: 'weekly',
    period_start: '2026-09-28',
    period_end: '2026-10-04',
    timezone: 'Asia/Manila',
    week_start: 1,
    status: 'submitted',
    approver_scope: 'team',
    revision: 2,
    submitted_at: '2026-10-05T01:00:00Z',
    submitted_by: null,
    submission_kind: 'on_deletion',
    decided_at: null,
    decided_by: null,
    decision_kind: null,
    decision_note: null,
    overtime_approved: false,
    total_seconds: 3600,
    payable_seconds: null,
    origin: 'app',
    created_at: '2026-09-28T00:00:00Z',
    updated_at: '2026-10-05T01:00:00Z',
  };
}

describe('AccountService.deleteAccount', () => {
  it('refuses a mistyped confirmation phrase without touching anything', async () => {
    const { service, rpc, verify } = build();
    await expect(
      service.deleteAccount(USER, EMAIL, validDto({ confirmation: 'delete' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(verify).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('accepts the phrase with stray case and whitespace', async () => {
    const { service, rpc } = build();
    await expect(
      service.deleteAccount(
        USER,
        EMAIL,
        validDto({ confirmation: '  Delete My Account ' }),
      ),
    ).resolves.toEqual({ deleted: true, summary: { deleted_projects: 2 } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('re-authenticates BEFORE calling the irreversible RPC', async () => {
    const order: string[] = [];
    const verify = jest.fn().mockImplementation(() => {
      order.push('verify');
      return Promise.resolve();
    });
    const { service, rpc } = build({ verify });
    rpc.mockImplementation(() => {
      order.push('rpc');
      return Promise.resolve({
        data: { deleted: true, summary: {} },
        error: null,
      });
    });

    await service.deleteAccount(USER, EMAIL, validDto());
    expect(order).toEqual(['verify', 'rpc']);
  });

  it('does not call the RPC when re-authentication fails', async () => {
    const verify = jest.fn().mockRejectedValue(new Error('nope'));
    const { service, rpc } = build({ verify });
    await expect(
      service.deleteAccount(USER, EMAIL, validDto()),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('revokes the caller tokens before resolving', async () => {
    const { service, revoke } = build();
    await service.deleteAccount(USER, EMAIL, validDto());
    // Awaited, not fire-and-forget: the response must not beat the deny-list
    // entry, or the caller's own token still works.
    expect(revoke).toHaveBeenCalledWith(USER);
  });

  it('still succeeds when the storage sweep throws', async () => {
    const sweep = jest.fn().mockRejectedValue(new Error('R2 unreachable'));
    const { service } = build({ sweep });
    // The account is already gone. Reporting failure would make the user retry
    // into ACCOUNT_ALREADY_DELETED and believe nothing happened.
    await expect(
      service.deleteAccount(USER, EMAIL, validDto()),
    ).resolves.toEqual({ deleted: true, summary: { deleted_projects: 2 } });
  });

  it('still succeeds when revocation throws', async () => {
    const revoke = jest.fn().mockRejectedValue(new Error('redis down'));
    const { service } = build({ revoke });
    await expect(
      service.deleteAccount(USER, EMAIL, validDto()),
    ).resolves.toMatchObject({ deleted: true });
  });

  describe('sentinel mapping', () => {
    const cases: Array<[string, unknown]> = [
      ['ACCOUNT_NOT_FOUND', NotFoundException],
      ['ACCOUNT_ALREADY_DELETED', ConflictException],
      ['ACCOUNT_IS_GUEST', BadRequestException],
      ['RESOLUTION_INCOMPLETE', BadRequestException],
      ['RESOLUTION_UNKNOWN_CONTAINER', ConflictException],
      ['RESOLUTION_INVALID_NOMINEE', ConflictException],
      ['CONTAINER_NOT_DELETABLE', ConflictException],
      ['WORKSPACE_HAS_ACTIVE_SUBSCRIPTION', ConflictException],
      ['WORKSPACE_HAS_PAYOUTS', ConflictException],
      ['TEAM_HAS_PAYOUTS', ConflictException],
      ['TEAM_HAS_OPEN_TIME', ConflictException],
      ['WORKSPACE_HAS_OPEN_TIME', ConflictException],
    ];

    it.each(cases)('maps %s', async (sentinel, expected) => {
      const { service } = build({
        rpcError: `some prefix: ${sentinel}`,
      });
      await expect(
        service.deleteAccount(USER, EMAIL, validDto()),
      ).rejects.toBeInstanceOf(expected as never);
    });

    it('marks the account intact when the transaction failed', async () => {
      const { service } = build({ rpcError: 'RESOLUTION_INCOMPLETE' });
      // The RPC is one transaction, so a failure changed nothing. The web keys
      // its "safe to retry" copy off this flag.
      await expect(
        service.deleteAccount(USER, EMAIL, validDto()),
      ).rejects.toMatchObject({
        response: { accountIntact: true },
      });
    });

    it('does not swallow an unrecognised failure', async () => {
      const { service } = build({ rpcError: 'deadlock detected' });
      await expect(
        service.deleteAccount(USER, EMAIL, validDto()),
      ).rejects.toMatchObject({
        response: { code: 'account_deletion_failed' },
      });
    });

    /**
     * The open-time blockers (L39, E8): time_raise makes the message the bare
     * code, and translate matches by containment, so the copy must be the
     * open-time one and never the payouts one.
     */
    it.each([
      [
        'TEAM_HAS_OPEN_TIME',
        'team_has_open_time',
        'This team has time waiting for approval or payment. Hand it to another member instead of deleting it.',
      ],
      [
        'WORKSPACE_HAS_OPEN_TIME',
        'workspace_has_open_time',
        'This workspace has time waiting for approval or payment. Hand it to another member instead of deleting it.',
      ],
    ])('maps %s to its own copy', async (sentinel, code, message) => {
      const { service } = build({ rpcError: sentinel });
      await expect(
        service.deleteAccount(USER, EMAIL, validDto()),
      ).rejects.toMatchObject({
        response: { code, message, accountIntact: true },
      });
    });

    it('maps an open-time blocker from the preflight too', async () => {
      const { service, rpc } = build();
      rpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'TEAM_HAS_OPEN_TIME' },
      });
      await expect(service.preflight(USER)).rejects.toMatchObject({
        response: { code: 'team_has_open_time' },
      });
    });
  });
});

/**
 * D54: delete_account submits the user's open and returned sheets in SQL
 * (`submit_on_deletion`, actor NULL), which cannot notify anyone. afterDeletion
 * sends the deciders their `timesheet_submitted` notice, best effort.
 */
describe('AccountService.deleteAccount — on-deletion timesheet notices', () => {
  it('notifies the deciders of each on-deletion sheet, with no actor', async () => {
    const sheets = [onDeletionSheet('sheet-1'), onDeletionSheet('sheet-2')];
    const approversFor = jest.fn((id: string) =>
      Promise.resolve(id === 'sheet-1' ? ['decider-1'] : ['decider-2', 'd-3']),
    );
    const { service, sheetSubmitted } = build({
      time: { sheets: { data: sheets, error: null }, approversFor },
    });

    await service.deleteAccount(USER, EMAIL, validDto());

    expect(approversFor).toHaveBeenCalledWith('sheet-1');
    expect(approversFor).toHaveBeenCalledWith('sheet-2');
    expect(sheetSubmitted).toHaveBeenCalledTimes(2);
    expect(sheetSubmitted).toHaveBeenCalledWith(sheets[0], ['decider-1'], null);
    expect(sheetSubmitted).toHaveBeenCalledWith(
      sheets[1],
      ['decider-2', 'd-3'],
      null,
    );
  });

  it("reads only the user's submitted on-deletion sheets that have deciders", async () => {
    const { service, from, sheetCalls } = build({ time: {} });

    await service.deleteAccount(USER, EMAIL, validDto());

    expect(from).toHaveBeenCalledWith('timesheets');
    expect(sheetCalls).toEqual(
      expect.arrayContaining([
        ['select', TIMESHEET_SELECT],
        ['eq', 'member_user_id', USER],
        ['eq', 'submission_kind', 'on_deletion'],
        ['eq', 'status', 'submitted'],
        // auto/self sheets have no one to tell: cron job 4 finishes them.
        ['not', 'approver_scope', 'in', '(auto,self)'],
      ]),
    );
  });

  it('runs after the token revoke', async () => {
    const order: string[] = [];
    const revoke = jest.fn(() => {
      order.push('revoke');
      return Promise.resolve();
    });
    const sheetSubmitted = jest.fn(() => {
      order.push('notice');
      return Promise.resolve();
    });
    const { service } = build({
      revoke,
      time: {
        sheets: { data: [onDeletionSheet('sheet-1')], error: null },
        sheetSubmitted,
      },
    });

    await service.deleteAccount(USER, EMAIL, validDto());
    expect(order).toEqual(['revoke', 'notice']);
  });

  it('awaits the notices before answering', async () => {
    let settled = false;
    const sheetSubmitted = jest.fn(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve();
          }, 5),
        ),
    );
    const { service } = build({
      time: {
        sheets: { data: [onDeletionSheet('sheet-1')], error: null },
        sheetSubmitted,
      },
    });

    await service.deleteAccount(USER, EMAIL, validDto());
    // Cloud Run freezes CPU after the response; nothing may be left detached.
    expect(settled).toBe(true);
  });

  it('still succeeds when the sheet read fails', async () => {
    const { service, sheetSubmitted, sweep } = build({
      time: { sheets: { data: null, error: { message: 'db down' } } },
    });

    await expect(
      service.deleteAccount(USER, EMAIL, validDto()),
    ).resolves.toEqual({ deleted: true, summary: { deleted_projects: 2 } });
    expect(sheetSubmitted).not.toHaveBeenCalled();
    // The later cleanup steps still run.
    expect(sweep).toHaveBeenCalledWith(USER);
  });

  it("still notifies the other sheets when one sheet's deciders cannot be read", async () => {
    const approversFor = jest.fn((id: string) =>
      id === 'sheet-1'
        ? Promise.reject(new Error('rpc failed'))
        : Promise.resolve(['decider-2']),
    );
    const { service, sheetSubmitted } = build({
      time: {
        sheets: {
          data: [onDeletionSheet('sheet-1'), onDeletionSheet('sheet-2')],
          error: null,
        },
        approversFor,
      },
    });

    await expect(
      service.deleteAccount(USER, EMAIL, validDto()),
    ).resolves.toMatchObject({ deleted: true });
    expect(sheetSubmitted).toHaveBeenCalledTimes(1);
    expect(sheetSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sheet-2' }),
      ['decider-2'],
      null,
    );
  });

  it('sends nothing when the deletion itself failed', async () => {
    const { service, from, sheetSubmitted } = build({
      rpcError: 'TEAM_HAS_OPEN_TIME',
      time: { sheets: { data: [onDeletionSheet('sheet-1')], error: null } },
    });

    await expect(
      service.deleteAccount(USER, EMAIL, validDto()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(from).not.toHaveBeenCalledWith('timesheets');
    expect(sheetSubmitted).not.toHaveBeenCalled();
  });

  it('skips the step when the time module is not wired', async () => {
    const { service, from } = build();
    await expect(
      service.deleteAccount(USER, EMAIL, validDto()),
    ).resolves.toMatchObject({ deleted: true });
    expect(from).not.toHaveBeenCalledWith('timesheets');
  });
});
