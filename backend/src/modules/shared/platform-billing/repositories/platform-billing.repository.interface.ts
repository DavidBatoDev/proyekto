import type { BillingInterval } from '../plan-catalog';
import type { BillingProviderId } from '../providers/billing-provider';

/** Mirrors the `plan` CHECK on workspace_subscriptions. */
export type BillingPlan = 'free' | 'pro' | 'business' | 'enterprise';

/**
 * Proyekto's normalized subscription vocabulary, matching the widened status
 * CHECK in 20260908120000_workspace_billing_provider.sql. Each provider adapter
 * maps its own statuses onto this set.
 */
export type BillingStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused';

/** A row of public.workspace_subscriptions, snake_case as it comes back. */
export interface WorkspaceSubscriptionRecord {
  workspace_id: string;
  plan: BillingPlan;
  status: BillingStatus;
  seat_limit: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  billing_provider: BillingProviderId | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  provider_subscription_item_id: string | null;
  provider_price_id: string | null;
  billing_interval: BillingInterval | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  trial_end: string | null;
  provider_updated_at: string | null;
  last_provider_event_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Just enough of the workspace to name a provider customer and build return URLs. */
export interface WorkspaceBillingContext {
  id: string;
  name: string;
  slug: string;
}

export interface BillingWebhookEventInsert {
  provider: BillingProviderId;
  event_id: string;
  type: string;
  api_version: string | null;
  event_created_at: string;
  workspace_id: string | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  payload: Record<string, unknown>;
}

/** (provider, event_id): event ids are only unique within one provider. */
export interface BillingEventKey {
  provider: BillingProviderId;
  event_id: string;
}

export interface BillingWebhookEventRecord extends BillingWebhookEventInsert {
  status: 'received' | 'processed' | 'ignored' | 'failed';
  attempts: number;
  error: string | null;
  received_at: string;
  processed_at: string | null;
}

/**
 * Rejects a write whose source is older than what the row already holds.
 * No provider guarantees event ordering, so this is applied in the UPDATE's
 * WHERE clause — one atomic check in one place, rather than an if-statement
 * repeated in every handler.
 */
export interface ProviderWriteGuard {
  notOlderThan: string;
}

export const PLATFORM_BILLING_REPOSITORY = Symbol(
  'PLATFORM_BILLING_REPOSITORY',
);

export interface PlatformBillingRepository {
  findByWorkspaceId(
    workspaceId: string,
  ): Promise<WorkspaceSubscriptionRecord | null>;

  findByProviderSubscriptionId(
    provider: BillingProviderId,
    subscriptionId: string,
  ): Promise<WorkspaceSubscriptionRecord | null>;

  findByProviderCustomerId(
    provider: BillingProviderId,
    customerId: string,
  ): Promise<WorkspaceSubscriptionRecord | null>;

  /**
   * createWorkspace seeds the subscription row best-effort and only logs on
   * failure, so a workspace can legitimately have none. Checkout must not 500
   * on those.
   */
  ensureRow(workspaceId: string): Promise<WorkspaceSubscriptionRecord>;

  /** Returns null when the guard rejected the write as stale. */
  updateSubscription(
    workspaceId: string,
    patch: Partial<WorkspaceSubscriptionRecord>,
    guard: ProviderWriteGuard,
  ): Promise<WorkspaceSubscriptionRecord | null>;

  /** Seats in use: an exact count, never a stored counter. */
  countSeats(workspaceId: string): Promise<number>;

  findWorkspace(workspaceId: string): Promise<WorkspaceBillingContext | null>;

  /** Owner emails, for the provider customer's receipt address and dunning. */
  listOwners(
    workspaceId: string,
  ): Promise<Array<{ user_id: string; email: string | null }>>;

  /** One page of the reconcile cron's scan: rows that have a provider subscription. */
  listReconcilable(
    limit: number,
    afterUpdatedAt: string | null,
  ): Promise<WorkspaceSubscriptionRecord[]>;

  /**
   * Idempotent claim. 'duplicate' means this event was already handled and the
   * caller must short-circuit; a previously failed event re-claims so the
   * provider's retry can actually reprocess it.
   */
  claimEvent(
    event: BillingWebhookEventInsert,
  ): Promise<'claimed' | 'duplicate'>;

  markEvent(
    key: BillingEventKey,
    status: 'processed' | 'ignored' | 'failed',
    error?: string | null,
  ): Promise<void>;

  listRetryableEvents(
    limit: number,
    olderThanIso: string,
  ): Promise<BillingWebhookEventRecord[]>;

  pruneEvents(olderThanIso: string): Promise<number>;
}
