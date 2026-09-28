import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from '@upstash/redis';
import { UPSTASH_REDIS_CLIENT } from '../../config/redis.tokens';

/**
 * A deny-list for users whose account has been deleted.
 *
 * WHY THIS EXISTS
 *
 * `SupabaseAuthGuard` verifies access tokens locally against
 * `SUPABASE_JWT_SECRET` and builds the user straight from the token payload -
 * no database round-trip, no revocation check (that fast path is the whole
 * point of it). `McpAuthGuard` does the same, and its OAuth access tokens are
 * self-signed and stateless besides. So deleting every `auth.sessions` and
 * `auth.refresh_tokens` row stops the user REFRESHING but leaves an
 * already-issued access token working until it expires -- `jwt_expiry` is 3600
 * in `supabase/config.toml`, so up to an hour.
 *
 * Without this, "you have been signed out everywhere" is not true, and a
 * just-deleted user could keep calling the API -- including re-running the
 * deletion, or writing into projects they were removed from seconds earlier.
 *
 * THE COST, AND WHY IT IS NOT A REDIS GET PER REQUEST
 *
 * The obvious implementation checks Redis on every authenticated request. That
 * is a 10-30ms round-trip added to every call in the product, to catch a case
 * that is vanishingly rare. Instead this keeps a short in-process NEGATIVE
 * cache: once Redis has said "this user is not revoked", we believe it for
 * {@link NEGATIVE_TTL_MS} without asking again.
 *
 * The residual window is therefore up to 60s per instance instead of up to an
 * hour, which is the tradeoff being made deliberately. A positive result is
 * cached too, permanently for the life of the process, because revocation is
 * terminal -- a user is never un-deleted.
 *
 * Fails OPEN. If Redis is unreachable the request proceeds: the alternative is
 * that an Upstash outage signs every user in the product out. By that point the
 * deleted user has no membership rows left, so their token can read almost
 * nothing. The honest structural fix is lowering `jwt_expiry`, which is a
 * project-config change, not a code one.
 */

/** Two JWT lifetimes plus slack, so the entry always outlives any live token. */
export const REVOKED_USER_TTL_SECONDS = 7500;

/** How long a "not revoked" answer is trusted without re-asking Redis. */
const NEGATIVE_TTL_MS = 60_000;

/** Stops the negative cache growing without bound on a long-lived instance. */
const MAX_CACHE_ENTRIES = 10_000;

export const revokedUserKey = (userId: string): string =>
  `auth:v1:revoked:user:${userId}`;

@Injectable()
export class RevokedUsersService {
  private readonly logger = new Logger(RevokedUsersService.name);

  /** userId -> epoch ms until which "not revoked" may be assumed. */
  private readonly notRevokedUntil = new Map<string, number>();

  /** userId set, for users Redis has confirmed are revoked. Terminal. */
  private readonly revoked = new Set<string>();

  constructor(
    @Inject(UPSTASH_REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  /**
   * Mark a user's tokens dead. Called after the deletion transaction commits
   * and BEFORE the response is returned, so the caller cannot race their own
   * token back in.
   *
   * Throws on failure, deliberately: the caller decides whether a deletion that
   * could not be announced should still report success.
   */
  async revoke(userId: string): Promise<void> {
    this.revoked.add(userId);
    this.notRevokedUntil.delete(userId);

    if (!this.redis) {
      this.logger.warn(
        `No Redis client configured; token revocation for ${userId} is process-local only.`,
      );
      return;
    }

    await this.redis.set(revokedUserKey(userId), '1', {
      ex: REVOKED_USER_TTL_SECONDS,
    });
  }

  /** Whether this user's tokens should be rejected. Never throws. */
  async isRevoked(userId: string): Promise<boolean> {
    if (this.revoked.has(userId)) return true;

    const until = this.notRevokedUntil.get(userId);
    if (until !== undefined && until > Date.now()) return false;

    if (!this.redis) return false;

    try {
      const hit = await this.redis.get(revokedUserKey(userId));
      if (hit !== null && hit !== undefined) {
        this.revoked.add(userId);
        return true;
      }
      this.rememberNotRevoked(userId);
      return false;
    } catch (error) {
      // Fail open - see the class comment.
      this.logger.warn(
        `Revocation check failed for ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  private rememberNotRevoked(userId: string): void {
    if (this.notRevokedUntil.size >= MAX_CACHE_ENTRIES) {
      // Cheapest possible eviction: drop the whole map. It is a latency
      // optimisation, not state, so losing it costs one Redis GET per user.
      this.notRevokedUntil.clear();
    }
    this.notRevokedUntil.set(userId, Date.now() + NEGATIVE_TTL_MS);
  }

  /** Test seam. */
  resetCachesForTesting(): void {
    this.notRevokedUntil.clear();
    this.revoked.clear();
  }
}
