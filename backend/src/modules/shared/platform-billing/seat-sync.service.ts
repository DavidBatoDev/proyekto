import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SeatProration } from './providers/billing-provider';
import { BillingProviderRegistry } from './providers/billing-provider.registry';
import {
  PLATFORM_BILLING_REPOSITORY,
  type PlatformBillingRepository,
} from './repositories/platform-billing.repository.interface';

export type SeatSyncReason =
  | 'member_joined'
  | 'member_removed'
  | 'reconcile'
  | 'checkout_completed';

export type SeatSyncOutcome =
  | { synced: true; from: number; to: number; proration: SeatProration }
  | {
      synced: false;
      skipped:
        | 'disabled'
        | 'no_paid_subscription'
        | 'zero_seats'
        | 'in_sync'
        | 'failed';
    };

const DEFAULT_BOUND_MS = 2_000;

@Injectable()
export class SeatSyncService {
  private readonly logger = new Logger(SeatSyncService.name);

  constructor(
    private readonly providers: BillingProviderRegistry,
    @Inject(PLATFORM_BILLING_REPOSITORY)
    private readonly repo: PlatformBillingRepository,
    private readonly config: ConfigService,
  ) {}

  /**
   * Pushes the workspace's true seat count to the provider that owns its
   * subscription — the row's billing_provider, not the currently active one,
   * so a workspace still on Stripe keeps syncing after new sales move to Polar.
   *
   * The billed quantity is read back from the provider on every call rather than kept
   * in a column. That is the deliberate cost of having no stored seat counter:
   * because each sync compares the live count against the live billed quantity,
   * a sync that never ran — a crash, a provider outage, a membership row written
   * by SQL that no TypeScript hook can see — is repaired by the next one.
   */
  async syncSeats(
    workspaceId: string,
    reason: SeatSyncReason,
  ): Promise<SeatSyncOutcome> {
    const subscription = await this.repo.findByWorkspaceId(workspaceId);
    if (
      !subscription ||
      subscription.plan === 'free' ||
      !subscription.provider_subscription_id
    ) {
      return { synced: false, skipped: 'no_paid_subscription' };
    }

    const provider = this.providers.get(subscription.billing_provider);
    if (!provider) return { synced: false, skipped: 'disabled' };

    const seats = await this.repo.countSeats(workspaceId);
    if (seats === 0) {
      // Unreachable through the API (assertNotLastOwner), but reachable by
      // deleting the last owner's profile, which CASCADEs their membership away.
      // Providers reject quantity 0 on a seat price anyway, so refuse loudly
      // here rather than turning a data problem into a billing exception.
      this.logger.warn(
        `Workspace ${workspaceId} has a paid subscription and zero members — leaving the billed quantity alone.`,
      );
      return { synced: false, skipped: 'zero_seats' };
    }

    const live = await provider.getSubscription(
      subscription.provider_subscription_id,
    );
    const billed = live.quantity ?? 0;
    if (billed === seats) return { synced: false, skipped: 'in_sync' };

    const proration = prorationFor(
      subscription.billing_interval,
      seats,
      billed,
    );

    // Adapters make this idempotent on the target quantity, so a double-fire —
    // two instances, or a retry after a timeout — never prorates twice.
    await provider.updateSeatQuantity({
      subscriptionId: live.id,
      seatItemId: live.seatItemId ?? subscription.provider_subscription_item_id,
      quantity: seats,
      proration,
    });

    this.logger.log(
      `Seat sync ${workspaceId} (${reason}): ${billed} -> ${seats}, proration=${proration}`,
    );
    return { synced: true, from: billed, to: seats, proration };
  }

  /**
   * The call site used from request handlers. Never throws and never blocks a
   * membership change: the member row is already committed by the time this
   * runs, so a provider outage must cost a reconciliation, not a failed join.
   *
   * Bounded rather than detached. Cloud Run can freeze instance CPU once the
   * response is sent — the same reason NotificationsService.sendPush and the
   * activity flush are bounded — so a fire-and-forget promise would routinely
   * never execute and silently under-bill until the cron caught up.
   */
  async syncSeatsBounded(
    workspaceId: string,
    reason: SeatSyncReason,
  ): Promise<void> {
    const boundMs =
      this.config.get<number>('PLATFORM_BILLING_SEAT_SYNC_BOUND_MS') ??
      DEFAULT_BOUND_MS;

    let timer: NodeJS.Timeout | undefined;
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, boundMs);
      timer.unref?.();
    });

    try {
      await Promise.race([
        this.syncSeats(workspaceId, reason)
          .then(() => undefined)
          .catch((error: unknown) =>
            this.recordFailure(workspaceId, reason, error),
          ),
        bound,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Flags the row so the reconcile cron scans it first. Stored in the existing
   * `metadata` jsonb rather than as a new column, following the
   * teams.pay_period_config precedent for state that evolves without a
   * migration.
   */
  private async recordFailure(
    workspaceId: string,
    reason: SeatSyncReason,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(
      `Seat sync failed for workspace ${workspaceId} (${reason}): ${message}`,
    );
    try {
      const current = await this.repo.findByWorkspaceId(workspaceId);
      if (!current) return;
      await this.repo.updateSubscription(
        workspaceId,
        {
          metadata: {
            ...current.metadata,
            seat_sync_pending: true,
            seat_sync_failed_at: new Date().toISOString(),
          },
        },
        // The flag is our own bookkeeping, not provider state, so it must not be
        // discarded by the ordering guard.
        { notOlderThan: new Date().toISOString() },
      );
    } catch (flagError: unknown) {
      this.logger.error(
        `Could not flag seat-sync failure for ${workspaceId}: ${
          flagError instanceof Error ? flagError.message : String(flagError)
        }`,
      );
    }
  }
}

/**
 * Reproduces Linear's billing behaviour exactly, in provider-neutral terms.
 * Adapters translate the result into their own flag (see SeatProration).
 *
 * Monthly → next_invoice: the new quantity is recorded and the next monthly
 * invoice bills it. Nothing is charged when someone joins mid-month and
 * nothing is credited when someone leaves.
 *
 * Annual, seats up → charge_now: charge for the remainder of the term
 * immediately, rather than parking it until the next annual invoice.
 *
 * Annual, seats down → credit_next_invoice: credit the unused remainder
 * against future invoices. Never a refund — the published copy promises credit,
 * not money back on the card.
 */
export function prorationFor(
  interval: 'month' | 'year' | null,
  seats: number,
  billed: number,
): SeatProration {
  if (interval !== 'year') return 'next_invoice';
  return seats > billed ? 'charge_now' : 'credit_next_invoice';
}
