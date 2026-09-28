import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import type { BillingProviderId } from '../providers/billing-provider';
import type {
  BillingEventKey,
  BillingWebhookEventInsert,
  BillingWebhookEventRecord,
  PlatformBillingRepository,
  ProviderWriteGuard,
  WorkspaceBillingContext,
  WorkspaceSubscriptionRecord,
} from './platform-billing.repository.interface';

const SUBSCRIPTION_COLUMNS = '*';

/** PostgREST caps an unbounded select; every multi-row read here pages explicitly. */
const PAGE_SIZE = 500;

@Injectable()
export class SupabasePlatformBillingRepository implements PlatformBillingRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async findByWorkspaceId(
    workspaceId: string,
  ): Promise<WorkspaceSubscriptionRecord | null> {
    return this.findOneBy('workspace_id', workspaceId);
  }

  async findByProviderSubscriptionId(
    provider: BillingProviderId,
    subscriptionId: string,
  ): Promise<WorkspaceSubscriptionRecord | null> {
    return this.findOneBy('provider_subscription_id', subscriptionId, provider);
  }

  async findByProviderCustomerId(
    provider: BillingProviderId,
    customerId: string,
  ): Promise<WorkspaceSubscriptionRecord | null> {
    return this.findOneBy('provider_customer_id', customerId, provider);
  }

  /** Provider-scoped lookups match the (billing_provider, id) UNIQUE indexes. */
  private async findOneBy(
    column: string,
    value: string,
    provider?: BillingProviderId,
  ): Promise<WorkspaceSubscriptionRecord | null> {
    let query = this.supabase
      .from('workspace_subscriptions')
      .select(SUBSCRIPTION_COLUMNS)
      .eq(column, value);
    if (provider) query = query.eq('billing_provider', provider);
    const { data, error } =
      await query.maybeSingle<WorkspaceSubscriptionRecord>();
    if (error) throw new Error(error.message);
    return data ?? null;
  }

  async ensureRow(workspaceId: string): Promise<WorkspaceSubscriptionRecord> {
    const existing = await this.findByWorkspaceId(workspaceId);
    if (existing) return existing;

    // ignoreDuplicates so a concurrent seed is not an error: two requests
    // racing to create the same free row should both end up reading it.
    const { error } = await this.supabase
      .from('workspace_subscriptions')
      .upsert(
        { workspace_id: workspaceId },
        {
          onConflict: 'workspace_id',
          ignoreDuplicates: true,
        },
      );
    if (error) throw new Error(error.message);

    const created = await this.findByWorkspaceId(workspaceId);
    if (!created) {
      throw new Error(
        `Failed to seed a subscription row for workspace ${workspaceId}.`,
      );
    }
    return created;
  }

  async updateSubscription(
    workspaceId: string,
    patch: Partial<WorkspaceSubscriptionRecord>,
    guard: ProviderWriteGuard,
  ): Promise<WorkspaceSubscriptionRecord | null> {
    // The monotonic guard lives in the WHERE clause, so a stale write matches
    // zero rows and reports itself rather than silently winning a race.
    const { data, error } = await this.supabase
      .from('workspace_subscriptions')
      .update(patch)
      .eq('workspace_id', workspaceId)
      .or(
        `provider_updated_at.is.null,provider_updated_at.lte."${guard.notOlderThan}"`,
      )
      .select(SUBSCRIPTION_COLUMNS)
      .maybeSingle<WorkspaceSubscriptionRecord>();
    if (error) throw new Error(error.message);
    return data ?? null;
  }

  async countSeats(workspaceId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('workspace_members')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  async findWorkspace(
    workspaceId: string,
  ): Promise<WorkspaceBillingContext | null> {
    const { data, error } = await this.supabase
      .from('workspaces')
      .select('id, name, slug')
      .eq('id', workspaceId)
      .maybeSingle<WorkspaceBillingContext>();
    if (error) throw new Error(error.message);
    return data ?? null;
  }

  async listOwners(
    workspaceId: string,
  ): Promise<Array<{ user_id: string; email: string | null }>> {
    const { data, error } = await this.supabase
      .from('workspace_members')
      .select(
        'user_id, profiles:profiles!workspace_members_user_id_fkey(email)',
      )
      .eq('workspace_id', workspaceId)
      .eq('role', 'owner')
      .order('joined_at', { ascending: true });
    if (error) throw new Error(error.message);

    type Row = {
      user_id: string;
      profiles:
        | { email: string | null }
        | Array<{ email: string | null }>
        | null;
    };
    return ((data ?? []) as Row[]).map((row) => {
      const profile = Array.isArray(row.profiles)
        ? row.profiles[0]
        : row.profiles;
      return { user_id: row.user_id, email: profile?.email ?? null };
    });
  }

  async listReconcilable(
    limit: number,
    afterUpdatedAt: string | null,
  ): Promise<WorkspaceSubscriptionRecord[]> {
    let query = this.supabase
      .from('workspace_subscriptions')
      .select(SUBSCRIPTION_COLUMNS)
      .not('provider_subscription_id', 'is', null)
      .order('updated_at', { ascending: true })
      .limit(limit);
    if (afterUpdatedAt) query = query.gt('updated_at', afterUpdatedAt);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as WorkspaceSubscriptionRecord[];
  }

  /**
   * Two statements rather than one `ON CONFLICT DO UPDATE ... WHERE`, because
   * PostgREST cannot express a conditional upsert. The semantics still hold:
   * under READ COMMITTED the second concurrent UPDATE re-evaluates
   * `status = 'failed'` against the committed row, so exactly one claim wins.
   *
   * The `status = 'failed'` condition is load-bearing. Without it, a handler
   * that returns 500 would be retried by the provider, see the existing row, report
   * 'duplicate', answer 200 — and the event would never be reprocessed.
   */
  async claimEvent(
    event: BillingWebhookEventInsert,
  ): Promise<'claimed' | 'duplicate'> {
    const { error } = await this.supabase
      .from('billing_webhook_events')
      .insert({ ...event, status: 'received', attempts: 1 });

    if (!error) return 'claimed';
    // 23505 = unique_violation: we have seen this (provider, event_id) before.
    if (error.code !== '23505') throw new Error(error.message);

    // Read the attempt count first so the retry claim can carry it forward.
    // A stale read is harmless here: `attempts` is diagnostic, and the
    // `status = 'failed'` predicate below is what actually decides the claim.
    const { data: existing, error: readError } = await this.supabase
      .from('billing_webhook_events')
      .select('attempts')
      .eq('provider', event.provider)
      .eq('event_id', event.event_id)
      .maybeSingle<{ attempts: number }>();
    if (readError) throw new Error(readError.message);

    const { data, error: retryError } = await this.supabase
      .from('billing_webhook_events')
      .update({
        status: 'received',
        error: null,
        attempts: (existing?.attempts ?? 0) + 1,
      })
      .eq('provider', event.provider)
      .eq('event_id', event.event_id)
      .eq('status', 'failed')
      .select('event_id')
      .maybeSingle();
    if (retryError) throw new Error(retryError.message);
    if (!data) return 'duplicate';

    return 'claimed';
  }

  async markEvent(
    key: BillingEventKey,
    status: 'processed' | 'ignored' | 'failed',
    error?: string | null,
  ): Promise<void> {
    const { error: updateError } = await this.supabase
      .from('billing_webhook_events')
      .update({
        status,
        error: error ?? null,
        processed_at: status === 'failed' ? null : new Date().toISOString(),
      })
      .eq('provider', key.provider)
      .eq('event_id', key.event_id);
    if (updateError) throw new Error(updateError.message);
  }

  async listRetryableEvents(
    limit: number,
    olderThanIso: string,
  ): Promise<BillingWebhookEventRecord[]> {
    const { data, error } = await this.supabase
      .from('billing_webhook_events')
      .select('*')
      .in('status', ['received', 'failed'])
      .lt('received_at', olderThanIso)
      .order('received_at', { ascending: true })
      .limit(Math.min(limit, PAGE_SIZE));
    if (error) throw new Error(error.message);
    return (data ?? []) as BillingWebhookEventRecord[];
  }

  async pruneEvents(olderThanIso: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('billing_webhook_events')
      .delete()
      .in('status', ['processed', 'ignored'])
      .lt('received_at', olderThanIso)
      .select('event_id');
    if (error) throw new Error(error.message);
    return (data ?? []).length;
  }
}
