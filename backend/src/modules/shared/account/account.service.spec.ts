import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RevokedUsersService } from '../../../common/auth/revoked-users.service';
import type { RedisCacheInvalidationService } from '../../../common/cache/redis-cache-invalidation.service';
import type { RedisDataCacheService } from '../../../common/cache/redis-data-cache.service';
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

function build(
  opts: {
    rpcError?: string;
    verify?: jest.Mock;
    sweep?: jest.Mock;
    revoke?: jest.Mock;
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
  const supabase = {
    rpc,
    from: jest.fn().mockReturnValue({ update }),
  } as unknown as SupabaseClient;

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

  const service = new AccountService(
    supabase,
    reauth,
    storage,
    revokedUsers,
    cache,
    cacheInvalidation,
  );
  return { service, rpc, verify, sweep, revoke, cacheInvalidation };
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
  });
});
