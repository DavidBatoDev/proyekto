import { Inject, Injectable, Logger } from '@nestjs/common';
import { BillingWebhookService } from './billing-webhook.service';
import { BillingProviderRegistry } from './providers/billing-provider.registry';
import {
  PLATFORM_BILLING_REPOSITORY,
  type PlatformBillingRepository,
  type WorkspaceSubscriptionRecord,
} from './repositories/platform-billing.repository.interface';
import { SeatSyncService } from './seat-sync.service';

const BATCH_SIZE = 100;
const RETRY_AFTER_MINUTES = 5;
const PRUNE_AFTER_DAYS = 90;

export interface ReconcileResult {
  scanned: number;
  seat_repairs: number;
  state_repairs: number;
  events_retried: number;
  events_pruned: number;
  orphaned: number;
  failed: number;
  /** True when no provider is configured on this deployment and nothing ran. */
  disabled?: boolean;
}

/**
 * The backstop that makes the whole design safe.
 *
 * It is not optional bookkeeping. `provision_default_workspace()` inserts a
 * workspace_members row from inside Postgres, and the workspace backfill
 * migration does too, so there are membership writes no TypeScript hook can
 * ever observe. Add a dropped webhook, a provider outage during an invite accept,
 * and an instance killed mid-request, and periodic reconciliation is the only
 * thing that guarantees the provider's quantity matches reality.
 *
 * Each row is reconciled against the provider named on the row, so a
 * deployment mid-way between two providers reconciles both.
 *
 * Driven by Cloud Scheduler rather than @nestjs/schedule, which this project
 * does not use: an in-process timer would fire once per Cloud Run instance.
 */
@Injectable()
export class BillingReconcileService {
  private readonly logger = new Logger(BillingReconcileService.name);

  constructor(
    private readonly providers: BillingProviderRegistry,
    @Inject(PLATFORM_BILLING_REPOSITORY)
    private readonly repo: PlatformBillingRepository,
    private readonly seatSync: SeatSyncService,
    private readonly webhooks: BillingWebhookService,
  ) {}

  async run(): Promise<ReconcileResult> {
    const result: ReconcileResult = {
      scanned: 0,
      seat_repairs: 0,
      state_repairs: 0,
      events_retried: 0,
      events_pruned: 0,
      orphaned: 0,
      failed: 0,
    };
    if (!this.providers.active()) {
      return { ...result, disabled: true };
    }

    let cursor: string | null = null;
    for (;;) {
      const page: WorkspaceSubscriptionRecord[] =
        await this.repo.listReconcilable(BATCH_SIZE, cursor);
      if (page.length === 0) break;

      for (const record of page) {
        result.scanned += 1;
        try {
          await this.reconcileOne(record, result);
        } catch (error: unknown) {
          result.failed += 1;
          this.logger.error(
            `Reconcile failed for workspace ${record.workspace_id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      if (page.length < BATCH_SIZE) break;
      cursor = page[page.length - 1].updated_at;
    }

    result.events_retried = await this.retryFailedEvents();
    result.events_pruned = await this.pruneOldEvents();
    this.logger.log(`Reconcile run: ${JSON.stringify(result)}`);
    return result;
  }

  private async reconcileOne(
    record: WorkspaceSubscriptionRecord,
    result: ReconcileResult,
  ): Promise<void> {
    const provider = this.providers.get(record.billing_provider);
    if (!provider) {
      this.logger.warn(
        `Workspace ${record.workspace_id} is billed through ${record.billing_provider ?? 'an unknown provider'}, which is not configured here.`,
      );
      return;
    }

    const seats = await this.repo.countSeats(record.workspace_id);
    if (seats === 0) {
      // Only reachable by deleting the last owner's profile, which CASCADEs the
      // membership away. Report it; do not guess at a fix.
      result.orphaned += 1;
      this.logger.warn(
        `Workspace ${record.workspace_id} is billed but has no members.`,
      );
    }

    const live = await provider.getSubscription(
      record.provider_subscription_id as string,
    );

    if (seats > 0 && live.quantity !== null && live.quantity !== seats) {
      result.seat_repairs += 1;
      await this.seatSync.syncSeats(record.workspace_id, 'reconcile');
    }

    const mapped = provider.resolvePlanForPrice(live.priceId);
    const drifted =
      (live.status !== null && record.status !== live.status) ||
      record.cancel_at_period_end !== live.cancelAtPeriodEnd ||
      (mapped !== null &&
        (record.plan !== mapped.plan ||
          record.billing_interval !== mapped.interval));

    const pending = record.metadata?.seat_sync_pending === true;

    if (drifted || pending) {
      if (drifted) result.state_repairs += 1;
      const metadata = { ...record.metadata };
      delete metadata.seat_sync_pending;
      delete metadata.seat_sync_failed_at;

      await this.repo.updateSubscription(
        record.workspace_id,
        {
          ...(mapped
            ? { plan: mapped.plan, billing_interval: mapped.interval }
            : {}),
          // Status is part of the drift check, so it must be part of the
          // repair too, or a drifted status would be counted forever and
          // never fixed.
          ...(live.status ? { status: live.status } : {}),
          cancel_at_period_end: live.cancelAtPeriodEnd,
          current_period_start: live.currentPeriodStart,
          current_period_end: live.currentPeriodEnd,
          metadata,
          // A live read is by definition the newest truth, so it stamps now.
          provider_updated_at: new Date().toISOString(),
        },
        { notOlderThan: new Date().toISOString() },
      );
    }
  }

  /**
   * Re-dispatches events left in received/failed. The provider's own retry
   * ladder is the primary mechanism; this catches the case where our handler
   * failed after the provider had already given up, and the window where an instance died between
   * claiming an event and processing it.
   */
  private async retryFailedEvents(): Promise<number> {
    const olderThan = new Date(
      Date.now() - RETRY_AFTER_MINUTES * 60_000,
    ).toISOString();
    const events = await this.repo.listRetryableEvents(50, olderThan);

    let retried = 0;
    for (const event of events) {
      try {
        // Mark failed first so claimEvent's `status = 'failed'` predicate lets
        // the replay through; a row still sitting in `received` would be
        // reported as a duplicate and never reprocessed.
        const key = { provider: event.provider, event_id: event.event_id };
        await this.repo.markEvent(key, 'failed', 'retry_sweep');
        await this.webhooks.replay(event);
        retried += 1;
      } catch (error: unknown) {
        this.logger.warn(
          `Retry of ${event.provider} event ${event.event_id} failed again: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return retried;
  }

  private async pruneOldEvents(): Promise<number> {
    const olderThan = new Date(
      Date.now() - PRUNE_AFTER_DAYS * 86_400_000,
    ).toISOString();
    return this.repo.pruneEvents(olderThan);
  }
}
