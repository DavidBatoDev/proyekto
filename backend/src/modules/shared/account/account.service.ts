import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { RevokedUsersService } from '../../../common/auth/revoked-users.service';
import { RedisCacheInvalidationService } from '../../../common/cache/redis-cache-invalidation.service';
import { RedisDataCacheService } from '../../../common/cache/redis-data-cache.service';
import { REDIS_CACHE_KEYS } from '../../../common/cache/redis-cache.keys';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { AccountReauthService } from './account-reauth.service';
import { AccountStorageService } from './account-storage.service';
import {
  DELETE_CONFIRMATION_PHRASE,
  DeleteAccountDto,
} from './dto/account-deletion.dto';

/**
 * Sentinels raised by `delete_account` / `account_deletion_preflight`, mapped
 * to the status and wording the client shows. Same shape as SIGNING_ERRORS in
 * contracts.service.ts: anything not listed falls through with its raw message
 * rather than being swallowed, so a new sentinel shows up in support instead of
 * disappearing.
 */
const DELETION_ERRORS: Record<
  string,
  { status: 'conflict' | 'bad_request' | 'not_found'; message: string }
> = {
  ACCOUNT_NOT_FOUND: {
    status: 'not_found',
    message: 'This account no longer exists.',
  },
  ACCOUNT_ALREADY_DELETED: {
    status: 'conflict',
    message: 'This account has already been deleted.',
  },
  ACCOUNT_IS_GUEST: {
    status: 'bad_request',
    message:
      'Guest sessions expire on their own, so there is no account to delete.',
  },
  RESOLUTION_INCOMPLETE: {
    status: 'bad_request',
    message: 'Choose what happens to each workspace and team first.',
  },
  RESOLUTION_UNKNOWN_CONTAINER: {
    status: 'conflict',
    message:
      'Your workspaces changed while you were deciding. Start again from the summary.',
  },
  RESOLUTION_INVALID_NOMINEE: {
    status: 'conflict',
    message: 'That person is no longer a member, so they cannot take it over.',
  },
  CONTAINER_NOT_DELETABLE: {
    status: 'conflict',
    message:
      'This one has to be handed to someone rather than deleted. Reload the summary to see why.',
  },
  WORKSPACE_HAS_ACTIVE_SUBSCRIPTION: {
    status: 'conflict',
    message:
      'This workspace still has a paid plan attached. Hand it to another member instead of deleting it.',
  },
  WORKSPACE_HAS_PAYOUTS: {
    status: 'conflict',
    message:
      'This workspace has payout records that have to be kept. Hand it to another member instead of deleting it.',
  },
  TEAM_HAS_PAYOUTS: {
    status: 'conflict',
    message:
      'This team has payout records that have to be kept. Hand it to another member instead of deleting it.',
  },
  TEAM_HAS_QA_FIXTURE: {
    status: 'conflict',
    message: 'This team is referenced by a test fixture and cannot be deleted.',
  },
  AUTH_SCRUB_FAILED: {
    status: 'conflict',
    message:
      'We could not complete the deletion safely, so nothing was changed. Please contact support@proyekto.tech.',
  },
};

export interface DeleteAccountResult {
  deleted: true;
  summary: Record<string, number>;
}

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly reauth: AccountReauthService,
    private readonly storage: AccountStorageService,
    private readonly revokedUsers: RevokedUsersService,
    private readonly cache: RedisDataCacheService,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
  ) {}

  /** What deleting this account would do. Safe to call repeatedly. */
  async preflight(userId: string): Promise<Record<string, unknown>> {
    const result = (await this.supabase.rpc('account_deletion_preflight', {
      p_user_id: userId,
    })) as {
      data: Record<string, unknown> | null;
      error: { message: string } | null;
    };
    if (result.error) throw this.translate(result.error.message);
    return result.data ?? {};
  }

  /** Mail a confirmation code. Only useful for accounts with no password. */
  async requestChallenge(
    userId: string,
    email: string | undefined,
  ): Promise<{ sent: boolean; expires_at: string }> {
    if (!email) {
      throw new BadRequestException(
        'This account has no email address to send a code to.',
      );
    }
    return this.reauth.issueChallenge(userId, email);
  }

  /**
   * Irreversible. Ordered so that a failure at any point before the RPC leaves
   * the account completely untouched, and everything after it is cleanup that
   * cannot un-delete anything.
   */
  async deleteAccount(
    userId: string,
    email: string | undefined,
    dto: DeleteAccountDto,
  ): Promise<DeleteAccountResult> {
    if (dto.confirmation.trim().toLowerCase() !== DELETE_CONFIRMATION_PHRASE) {
      throw new BadRequestException(
        `Type "${DELETE_CONFIRMATION_PHRASE}" to confirm.`,
      );
    }

    if (!email) {
      throw new BadRequestException(
        'This account has no email address, so it cannot be verified.',
      );
    }

    // Re-authenticate BEFORE anything else. Everything past this point is
    // either a read or irreversible.
    await this.reauth.verify(userId, email, {
      password: dto.password,
      code: dto.code,
    });

    const rpc = (await this.supabase.rpc('delete_account', {
      p_user_id: userId,
      p_resolution: { containers: dto.containers ?? [] },
    })) as {
      data: { summary?: Record<string, number> } | null;
      error: { message: string } | null;
    };

    if (rpc.error) {
      // The RPC is one transaction, so a failure here means nothing changed.
      // The client keys its "you can safely retry" copy off this.
      throw this.translate(rpc.error.message, { accountIntact: true });
    }

    const result = rpc.data ?? {};

    // The account is gone from the database. From here on nothing may throw:
    // reporting failure would make the user believe it did not work and retry
    // into ACCOUNT_ALREADY_DELETED.
    await this.afterDeletion(userId);

    return { deleted: true, summary: result.summary ?? {} };
  }

  /**
   * Post-commit cleanup. Each step is independently best-effort and logged,
   * because none of them can be undone by failing the request.
   */
  private async afterDeletion(userId: string): Promise<void> {
    // FIRST, and awaited: without this the user keeps a working access token
    // until it expires. See RevokedUsersService.
    try {
      await this.revokedUsers.revoke(userId);
    } catch (error) {
      this.logger.error(
        `Token revocation failed for deleted user ${userId}; their access token stays valid until it expires: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Public directory caches are query-hash keyed, so without this the
    // deleted person keeps appearing on public marketplace pages until TTL.
    await this.safely('cache invalidation', async () => {
      await this.cacheInvalidation.invalidateDiscoveryCaches(userId);
      await this.cacheInvalidation.invalidateDashboardCacheForUser(userId);
      await this.cache.del(REDIS_CACHE_KEYS.profileAppearanceByUser(userId));
      await this.cache.del(
        REDIS_CACHE_KEYS.aiContextOverviewIndexByUser(userId),
      );
    });

    const sweep = await this.storage
      .sweepUser(userId)
      .catch((error: unknown) => ({
        status: 'failed' as const,
        deleted: 0,
        error: error instanceof Error ? error.message : String(error),
      }));

    await this.safely('storage status write', async () => {
      await this.supabase
        .from('account_deletions')
        .update({
          storage_status: sweep.status,
          storage_error: sweep.error ?? null,
        })
        .eq('user_id', userId);
    });

    if (sweep.status !== 'done') {
      this.logger.error(
        `Storage sweep for deleted user ${userId} finished ${sweep.status}: ${sweep.error ?? 'unknown'}`,
      );
    }
  }

  private async safely(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.error(
        `Post-deletion ${label} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Postgres prefixes RAISE messages, so match on containment rather than
   * equality. Unknown messages pass through as a 500 with the original text:
   * losing a new sentinel silently is worse than an ugly error.
   */
  private translate(raw: string, extra?: { accountIntact?: boolean }): Error {
    const entry = Object.entries(DELETION_ERRORS).find(([code]) =>
      raw.includes(code),
    );

    if (!entry) {
      this.logger.error(`Unmapped account-deletion failure: ${raw}`);
      return new InternalServerErrorException({
        message:
          'Something went wrong and nothing was deleted. Please try again.',
        code: 'account_deletion_failed',
        ...extra,
      });
    }

    const [code, { status, message }] = entry;
    const body = { message, code: code.toLowerCase(), ...extra };

    if (status === 'not_found') return new NotFoundException(body);
    if (status === 'bad_request') return new BadRequestException(body);
    return new ConflictException(body);
  }
}
