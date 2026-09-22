import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  BillingEventKind,
  BillingProvider,
  ProviderEvent,
} from './providers/billing-provider';
import { BillingProviderRegistry } from './providers/billing-provider.registry';
import {
  PLATFORM_BILLING_REPOSITORY,
  type BillingWebhookEventRecord,
  type PlatformBillingRepository,
  type WorkspaceSubscriptionRecord,
} from './repositories/platform-billing.repository.interface';

export type WebhookOutcome = 'processed' | 'ignored' | 'duplicate';

/**
 * Provider-neutral webhook handling.
 *
 * The adapter verifies the signature and translates the event into a
 * BillingEventKind; everything after that — idempotent claiming, the retry
 * contract, workspace resolution, the monotonic write guard, "an unknown price
 * never downgrades", dunning — is written here once for every provider.
 *
 * Every write here lands on workspace_subscriptions only. A complimentary plan
 * lives on the workspaces row, so no webhook can grant, extend or clear one;
 * when a paid plan ends, an active comp simply takes over again.
 */
@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(
    private readonly providers: BillingProviderRegistry,
    @Inject(PLATFORM_BILLING_REPOSITORY)
    private readonly repo: PlatformBillingRepository,
    private readonly notifications: NotificationsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async handle(
    providerId: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<WebhookOutcome> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      // 404, not 503: an unconfigured provider has no endpoint here at all.
      throw new NotFoundException(
        `Billing provider "${providerId}" is not configured.`,
      );
    }
    return this.dispatch(provider, provider.verifyWebhook(rawBody, headers));
  }

  /** Re-dispatch of a stored payload by the reconcile cron's retry sweep. */
  async replay(record: BillingWebhookEventRecord): Promise<WebhookOutcome> {
    const provider = this.providers.get(record.provider);
    if (!provider) {
      throw new Error(
        `Cannot replay ${record.provider} event ${record.event_id}: provider not configured.`,
      );
    }
    return this.dispatch(provider, provider.parseStoredEvent(record.payload));
  }

  /** Exposed for specs: dispatch an already-translated event. */
  async dispatch(
    provider: BillingProvider,
    event: ProviderEvent,
  ): Promise<WebhookOutcome> {
    const key = { provider: provider.id, event_id: event.id };

    const claim = await this.repo.claimEvent({
      ...key,
      type: event.type,
      api_version: event.apiVersion,
      event_created_at: event.createdAt,
      workspace_id: null,
      provider_customer_id: event.customerId,
      provider_subscription_id: event.subscriptionId,
      payload: event.payload,
    });
    if (claim === 'duplicate') return 'duplicate';

    if (event.meaning.kind === 'unhandled') {
      await this.repo.markEvent(key, 'ignored', 'unhandled_event_type');
      return 'ignored';
    }

    try {
      const handled = await this.route(provider, event.meaning, event.id);
      await this.repo.markEvent(
        key,
        handled ? 'processed' : 'ignored',
        handled ? null : 'unresolved_workspace',
      );
      return handled ? 'processed' : 'ignored';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `${provider.id} event ${event.id} (${event.type}): ${message}`,
      );
      await this.repo.markEvent(key, 'failed', message);
      // Rethrow so the controller answers 500 and the provider's retry ladder
      // engages. The row stays `failed`, which is also what lets the cron's
      // retry sweep pick it up. Two independent retry mechanisms is the right
      // amount for money.
      throw error;
    }
  }

  /** @returns false when the event could not be tied to a workspace. */
  private async route(
    provider: BillingProvider,
    meaning: Exclude<BillingEventKind, { kind: 'unhandled' }>,
    eventId: string,
  ): Promise<boolean> {
    switch (meaning.kind) {
      case 'checkout_completed':
        return this.onCheckoutCompleted(provider, meaning, eventId);
      case 'subscription_changed':
        return this.onSubscriptionChanged(
          provider,
          meaning.subscriptionId,
          eventId,
        );
      case 'subscription_ended':
        return this.onSubscriptionEnded(provider, meaning, eventId);
      case 'payment_failed':
        return this.onPaymentFailed(provider, meaning);
      case 'payment_succeeded':
        return this.onPaymentSucceeded(provider, meaning);
      case 'dispute_opened':
        // Flag only. Locking a workspace on a dispute turns a $12 disagreement
        // into a churned account. Plan limits follow the subscription's status,
        // not disputes, so a dispute changes nothing a member can do.
        this.logger.warn(`${provider.id} dispute opened: ${meaning.reference}`);
        return true;
    }
  }

  private async onCheckoutCompleted(
    provider: BillingProvider,
    meaning: Extract<BillingEventKind, { kind: 'checkout_completed' }>,
    eventId: string,
  ): Promise<boolean> {
    const { workspaceId, subscriptionId } = meaning;
    if (!workspaceId || !subscriptionId) {
      this.logger.warn(
        `${provider.id} checkout completion ${eventId} carried no workspace or subscription.`,
      );
      return false;
    }

    const existing = await this.repo.ensureRow(workspaceId);
    if (
      existing.provider_subscription_id &&
      !(
        existing.billing_provider === provider.id &&
        existing.provider_subscription_id === subscriptionId
      )
    ) {
      // Two owners checked out at once. Keep the first and cancel the second
      // rather than silently billing the workspace twice.
      this.logger.error(
        `Workspace ${workspaceId} already holds ${existing.billing_provider} subscription ${existing.provider_subscription_id}; cancelling duplicate ${provider.id} ${subscriptionId}.`,
      );
      await provider.cancelSubscription(subscriptionId);
      return true;
    }

    return this.writeFromSubscription(
      provider,
      workspaceId,
      subscriptionId,
      eventId,
      meaning.customerId ? { provider_customer_id: meaning.customerId } : {},
    );
  }

  private async onSubscriptionChanged(
    provider: BillingProvider,
    subscriptionId: string,
    eventId: string,
  ): Promise<boolean> {
    const record = await this.repo.findByProviderSubscriptionId(
      provider.id,
      subscriptionId,
    );
    if (!record) {
      this.logger.warn(
        `${provider.id} subscription ${subscriptionId} matches no workspace — ignoring.`,
      );
      return false;
    }
    return this.writeFromSubscription(
      provider,
      record.workspace_id,
      subscriptionId,
      eventId,
    );
  }

  /**
   * Writes state from a LIVE read of the subscription rather than from the
   * event payload.
   *
   * No provider guarantees ordering, and a single plan change can emit several
   * update events in a burst, so treating the event as a payload lets a late
   * arrival resurrect stale state. Treating it as a trigger — and re-reading —
   * means even a three-day-old replayed event converges on current truth.
   */
  private async writeFromSubscription(
    provider: BillingProvider,
    workspaceId: string,
    subscriptionId: string,
    eventId: string,
    extra: Partial<WorkspaceSubscriptionRecord> = {},
  ): Promise<boolean> {
    const live = await provider.getSubscription(subscriptionId);
    const mapped = provider.resolvePlanForPrice(live.priceId);
    const existing = await this.repo.findByWorkspaceId(workspaceId);

    const patch: Partial<WorkspaceSubscriptionRecord> = {
      billing_provider: provider.id,
      provider_customer_id: live.customerId,
      ...extra,
      // Omitted when the provider reported a status outside the normalized
      // vocabulary: writing it would violate the status CHECK and lose the rest
      // of the update. Keeping the previous status is strictly better.
      ...(live.status ? { status: live.status } : {}),
      provider_subscription_id: live.id,
      provider_subscription_item_id: live.seatItemId,
      provider_price_id: live.priceId,
      cancel_at_period_end: live.cancelAtPeriodEnd,
      canceled_at: live.canceledAt,
      trial_end: live.trialEnd,
      current_period_start: live.currentPeriodStart,
      current_period_end: live.currentPeriodEnd,
      provider_updated_at: new Date().toISOString(),
      last_provider_event_id: eventId,
    };

    // An unrecognised price leaves the stored plan alone. Defaulting to `free`
    // here is how a negotiated Enterprise price would silently un-bill the
    // biggest customer on the platform.
    if (mapped) {
      patch.plan = mapped.plan;
      patch.billing_interval = mapped.interval;
    }

    const written = await this.repo.updateSubscription(workspaceId, patch, {
      notOlderThan: existing?.provider_updated_at ?? new Date().toISOString(),
    });
    if (!written) {
      this.logger.log(
        `Discarded a stale write for workspace ${workspaceId} from event ${eventId}.`,
      );
    } else {
      // The plan or status may have changed what the workspace is entitled to.
      await this.invalidatePlanState(workspaceId);
    }
    return true;
  }

  private async onSubscriptionEnded(
    provider: BillingProvider,
    meaning: Extract<BillingEventKind, { kind: 'subscription_ended' }>,
    eventId: string,
  ): Promise<boolean> {
    const record = await this.repo.findByProviderSubscriptionId(
      provider.id,
      meaning.subscriptionId,
    );
    if (!record) return false;

    await this.repo.updateSubscription(
      record.workspace_id,
      {
        plan: 'free',
        status: 'canceled',
        canceled_at: meaning.canceledAt ?? new Date().toISOString(),
        provider_subscription_id: null,
        provider_subscription_item_id: null,
        provider_price_id: null,
        billing_interval: null,
        cancel_at_period_end: false,
        trial_end: null,
        // billing_provider and provider_customer_id are deliberately RETAINED:
        // re-subscribing through the same provider should reuse the customer,
        // its saved payment methods and its invoice history.
        provider_updated_at: new Date().toISOString(),
        last_provider_event_id: eventId,
      },
      { notOlderThan: record.provider_updated_at ?? new Date().toISOString() },
    );
    await this.invalidatePlanState(record.workspace_id);
    return true;
  }

  private async onPaymentFailed(
    provider: BillingProvider,
    meaning: Extract<BillingEventKind, { kind: 'payment_failed' }>,
  ): Promise<boolean> {
    const record = await this.resolveRecord(provider, meaning);
    if (!record) return false;

    // No state write here: the paired subscription update sets past_due. The
    // provider owns the retry schedule, so this only tells the humans who can
    // fix it.
    await this.notifyOwners(record.workspace_id, 'workspace_payment_failed', {
      amount_due: meaning.amountDueCents,
      currency: meaning.currency,
      hosted_invoice_url: meaning.invoiceUrl,
    });
    return true;
  }

  private async onPaymentSucceeded(
    provider: BillingProvider,
    meaning: Extract<BillingEventKind, { kind: 'payment_succeeded' }>,
  ): Promise<boolean> {
    const record = await this.resolveRecord(provider, meaning);
    if (!record) return false;
    if (!record.metadata?.dunning_since) return true;

    const metadata = { ...record.metadata };
    delete metadata.dunning_since;
    await this.repo.updateSubscription(
      record.workspace_id,
      { metadata },
      { notOlderThan: new Date().toISOString() },
    );
    return true;
  }

  /**
   * Drops the cached effective plan so limits follow the new state at once
   * rather than within the cache's 60 seconds. Never fails the event: the
   * write has already happened, and the cache expires on its own.
   */
  private async invalidatePlanState(workspaceId: string): Promise<void> {
    try {
      await this.entitlements.invalidateWorkspace(workspaceId);
    } catch (error: unknown) {
      this.logger.warn(
        `Could not invalidate the plan state of workspace ${workspaceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Payment events carry a subscription id on some providers, a customer on others. */
  private async resolveRecord(
    provider: BillingProvider,
    ids: { subscriptionId: string | null; customerId: string | null },
  ): Promise<WorkspaceSubscriptionRecord | null> {
    if (ids.subscriptionId) {
      const bySubscription = await this.repo.findByProviderSubscriptionId(
        provider.id,
        ids.subscriptionId,
      );
      if (bySubscription) return bySubscription;
    }
    if (ids.customerId) {
      return this.repo.findByProviderCustomerId(provider.id, ids.customerId);
    }
    return null;
  }

  private async notifyOwners(
    workspaceId: string,
    typeName: string,
    content: Record<string, unknown>,
  ): Promise<void> {
    const owners = await this.repo.listOwners(workspaceId);
    const workspace = await this.repo.findWorkspace(workspaceId);
    const linkUrl = workspace
      ? `/w/${workspace.slug}/settings/billing`
      : undefined;

    for (const owner of owners) {
      try {
        await this.notifications.createNotification({
          user_id: owner.user_id,
          // notifications.project_id is nullable (unlike project_activity_log's),
          // which is why a workspace-scoped notification needs no schema change.
          type_name: typeName,
          content: { ...content, workspace_name: workspace?.name ?? null },
          link_url: linkUrl,
        } as never);
      } catch (error: unknown) {
        this.logger.error(
          `Could not notify owner ${owner.user_id} of ${typeName}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
