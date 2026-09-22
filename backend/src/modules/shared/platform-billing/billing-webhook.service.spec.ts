/* eslint-disable @typescript-eslint/unbound-method --
 * The entitlements double is a jest.Mocked object; passing its members to
 * expect() is an identity check on the mock, never a call, so `this` scoping
 * is irrelevant.
 */
import { NotFoundException } from '@nestjs/common';
import { allowAllEntitlements } from '../entitlements/__entitlements-test-kit-spec';
import {
  buildEvent,
  buildFakeProvider,
  buildLiveSubscription,
  buildRecord,
  buildRegistry,
} from './__billing-test-kit-spec';
import { BillingWebhookService } from './billing-webhook.service';
import type { WorkspaceSubscriptionRecord } from './repositories/platform-billing.repository.interface';

function buildDeps(
  options: {
    record?: WorkspaceSubscriptionRecord | null;
    claim?: 'claimed' | 'duplicate';
    priceId?: string;
  } = {},
) {
  const record = options.record === undefined ? buildRecord() : options.record;
  const provider = buildFakeProvider(
    'polar',
    buildLiveSubscription({ priceId: options.priceId ?? 'price_pro_month' }),
  );
  const repo = {
    claimEvent: jest.fn().mockResolvedValue(options.claim ?? 'claimed'),
    markEvent: jest.fn().mockResolvedValue(undefined),
    ensureRow: jest.fn().mockResolvedValue(record ?? buildRecord()),
    findByWorkspaceId: jest.fn().mockResolvedValue(record),
    findByProviderSubscriptionId: jest.fn().mockResolvedValue(record),
    findByProviderCustomerId: jest.fn().mockResolvedValue(record),
    updateSubscription: jest.fn().mockResolvedValue(record),
    listOwners: jest
      .fn()
      .mockResolvedValue([{ user_id: 'u1', email: 'a@b.c' }]),
    findWorkspace: jest
      .fn()
      .mockResolvedValue({ id: 'ws-1', name: 'Acme', slug: 'acme' }),
  };
  const notifications = { createNotification: jest.fn().mockResolvedValue({}) };
  const entitlements = allowAllEntitlements();
  const service = new BillingWebhookService(
    buildRegistry(provider) as never,
    repo as never,
    notifications as never,
    entitlements,
  );
  return { service, repo, provider, notifications, entitlements };
}

/** The complimentary-plan columns. They live on workspaces, never on a subscription patch. */
const COMP_KEYS = [
  'is_discounted_free',
  'discounted_plan',
  'discounted_at',
  'discounted_until',
];

const KEY = { provider: 'polar', event_id: 'evt_1' };

describe('BillingWebhookService — idempotency', () => {
  it('ledgers the event under (provider, event_id)', async () => {
    const { service, repo, provider } = buildDeps();

    await service.dispatch(
      provider,
      buildEvent({ kind: 'subscription_changed', subscriptionId: 'sub_1' }),
    );

    expect(repo.claimEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'polar',
        event_id: 'evt_1',
        provider_subscription_id: 'sub_1',
      }),
    );
  });

  it('short-circuits a duplicate delivery without touching state', async () => {
    const { service, repo, provider } = buildDeps({ claim: 'duplicate' });

    const outcome = await service.dispatch(
      provider,
      buildEvent({ kind: 'subscription_changed', subscriptionId: 'sub_1' }),
    );

    expect(outcome).toBe('duplicate');
    expect(provider.getSubscription).not.toHaveBeenCalled();
    expect(repo.updateSubscription).not.toHaveBeenCalled();
  });

  it('leaves the event row `failed` when the handler throws, so both retry paths can find it', async () => {
    // The provider's retry ladder and the reconcile sweep both key off
    // `failed`, and the claim itself only re-opens a row in that state.
    const { service, repo, provider } = buildDeps();
    provider.getSubscription.mockRejectedValue(new Error('provider down'));

    await expect(
      service.dispatch(
        provider,
        buildEvent({ kind: 'subscription_changed', subscriptionId: 'sub_1' }),
      ),
    ).rejects.toThrow('provider down');

    expect(repo.markEvent).toHaveBeenCalledWith(
      KEY,
      'failed',
      expect.stringContaining('provider down'),
    );
  });

  it('ignores an event kind it does not act on instead of failing', async () => {
    const { service, repo, provider } = buildDeps();

    expect(
      await service.dispatch(provider, buildEvent({ kind: 'unhandled' })),
    ).toBe('ignored');
    expect(repo.markEvent).toHaveBeenCalledWith(
      KEY,
      'ignored',
      'unhandled_event_type',
    );
  });
});

describe('BillingWebhookService — routing', () => {
  it('404s a webhook for a provider that is not configured', async () => {
    const { service } = buildDeps();

    await expect(
      service.handle('paddle', Buffer.from('{}'), {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('verifies through the named provider and dispatches what it returns', async () => {
    const { service, provider } = buildDeps();
    provider.verifyWebhook.mockReturnValue(buildEvent({ kind: 'unhandled' }));
    const body = Buffer.from('{}');
    const headers = { 'webhook-signature': 'sig' };

    expect(await service.handle('polar', body, headers)).toBe('ignored');
    expect(provider.verifyWebhook).toHaveBeenCalledWith(body, headers);
  });

  it('replays a stored row through the provider recorded on it', async () => {
    const { service, provider } = buildDeps();
    provider.parseStoredEvent.mockReturnValue(
      buildEvent({ kind: 'unhandled' }),
    );

    await service.replay({
      provider: 'polar',
      event_id: 'evt_1',
      payload: { id: 'evt_1' },
    } as never);

    expect(provider.parseStoredEvent).toHaveBeenCalledWith({ id: 'evt_1' });
  });
});

describe('BillingWebhookService — subscription state', () => {
  it('writes from a live read, not from the event payload', async () => {
    // No provider guarantees ordering, so a replayed event must converge on
    // current truth rather than resurrect whatever it was carrying.
    const { service, provider, repo } = buildDeps();

    await service.dispatch(
      provider,
      buildEvent({ kind: 'subscription_changed', subscriptionId: 'sub_1' }),
    );

    expect(provider.getSubscription).toHaveBeenCalledWith('sub_1');
    expect(repo.updateSubscription).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({
        billing_provider: 'polar',
        status: 'active',
        provider_subscription_id: 'sub_1',
      }),
      expect.anything(),
    );
  });

  it('looks the subscription up within the sending provider only', async () => {
    const { service, provider, repo } = buildDeps();

    await service.dispatch(
      provider,
      buildEvent({ kind: 'subscription_changed', subscriptionId: 'sub_1' }),
    );

    expect(repo.findByProviderSubscriptionId).toHaveBeenCalledWith(
      'polar',
      'sub_1',
    );
  });

  it('keeps the stored status when the provider reports one outside the vocabulary', async () => {
    const { service, provider, repo } = buildDeps();
    provider.getSubscription.mockResolvedValue(
      buildLiveSubscription({ status: null }),
    );

    await service.dispatch(
      provider,
      buildEvent({ kind: 'subscription_changed', subscriptionId: 'sub_1' }),
    );

    expect(repo.updateSubscription.mock.calls[0][1]).not.toHaveProperty(
      'status',
    );
  });

  it('never downgrades a workspace on an unrecognised price', async () => {
    // An Enterprise custom price, or one archived during a re-pricing, must
    // leave the stored plan alone — resolving it to `free` would silently
    // un-bill the largest customer on the platform.
    const { service, provider, repo } = buildDeps({
      priceId: 'price_negotiated',
    });

    await service.dispatch(
      provider,
      buildEvent({ kind: 'subscription_changed', subscriptionId: 'sub_1' }),
    );

    const patch = repo.updateSubscription.mock.calls[0][1];
    expect(patch).not.toHaveProperty('plan');
    expect(patch).not.toHaveProperty('billing_interval');
  });

  it('maps a recognised price to its plan and interval', async () => {
    const { service, provider, repo } = buildDeps({
      priceId: 'price_business_year',
    });

    await service.dispatch(
      provider,
      buildEvent({ kind: 'subscription_changed', subscriptionId: 'sub_1' }),
    );

    expect(repo.updateSubscription.mock.calls[0][1]).toMatchObject({
      plan: 'business',
      billing_interval: 'year',
    });
  });

  it('reports a stale write as processed, not failed — staleness is expected', async () => {
    const { service, provider, repo } = buildDeps();
    repo.updateSubscription.mockResolvedValue(null);

    const outcome = await service.dispatch(
      provider,
      buildEvent({ kind: 'subscription_changed', subscriptionId: 'sub_1' }),
    );

    expect(outcome).toBe('processed');
    expect(repo.markEvent).toHaveBeenCalledWith(KEY, 'processed', null);
  });

  it('returns to free on cancellation but RETAINS the provider and customer', async () => {
    // Keeping them means a re-subscribe through the same provider reuses its
    // saved payment methods and invoice history.
    const { service, provider, repo } = buildDeps();

    await service.dispatch(
      provider,
      buildEvent({
        kind: 'subscription_ended',
        subscriptionId: 'sub_1',
        canceledAt: '2026-09-10T00:00:00.000Z',
      }),
    );

    const patch = repo.updateSubscription.mock.calls[0][1];
    expect(patch).toMatchObject({
      plan: 'free',
      status: 'canceled',
      provider_subscription_id: null,
      provider_subscription_item_id: null,
    });
    expect(patch).not.toHaveProperty('provider_customer_id');
    expect(patch).not.toHaveProperty('billing_provider');
  });
});

describe('BillingWebhookService — checkout completion', () => {
  it('binds the subscription to the workspace named at checkout', async () => {
    const { service, provider, repo } = buildDeps({
      record: buildRecord({
        billing_provider: null,
        provider_customer_id: null,
        provider_subscription_id: null,
        plan: 'free',
      }),
    });

    await service.dispatch(
      provider,
      buildEvent({
        kind: 'checkout_completed',
        workspaceId: 'ws-1',
        subscriptionId: 'sub_1',
        customerId: 'cus_9',
      }),
    );

    expect(repo.updateSubscription.mock.calls[0][1]).toMatchObject({
      billing_provider: 'polar',
      provider_customer_id: 'cus_9',
      provider_subscription_id: 'sub_1',
      plan: 'pro',
    });
  });

  it('cancels a second subscription rather than billing a workspace twice', async () => {
    const { service, provider } = buildDeps({
      record: buildRecord({ provider_subscription_id: 'sub_first' }),
    });

    await service.dispatch(
      provider,
      buildEvent({
        kind: 'checkout_completed',
        workspaceId: 'ws-1',
        subscriptionId: 'sub_second',
        customerId: 'cus_1',
      }),
    );

    expect(provider.cancelSubscription).toHaveBeenCalledWith('sub_second');
  });

  it('also cancels when the live subscription belongs to a different provider', async () => {
    // A workspace already paying through Stripe must not be double-billed by a
    // stray Polar checkout, even though the subscription ids cannot collide.
    const { service, provider } = buildDeps({
      record: buildRecord({
        billing_provider: 'stripe',
        provider_subscription_id: 'sub_1',
      }),
    });

    await service.dispatch(
      provider,
      buildEvent({
        kind: 'checkout_completed',
        workspaceId: 'ws-1',
        subscriptionId: 'sub_1',
        customerId: 'cus_1',
      }),
    );

    expect(provider.cancelSubscription).toHaveBeenCalledWith('sub_1');
  });
});

describe('BillingWebhookService — unresolvable events', () => {
  it('ignores rather than fails an event for a workspace we do not have', async () => {
    // Otherwise a subscription created in another environment sharing the
    // provider account would retry against us for days.
    const { service, provider, repo } = buildDeps({ record: null });

    const outcome = await service.dispatch(
      provider,
      buildEvent({ kind: 'subscription_changed', subscriptionId: 'sub_x' }),
    );

    expect(outcome).toBe('ignored');
    expect(repo.markEvent).toHaveBeenCalledWith(
      KEY,
      'ignored',
      'unresolved_workspace',
    );
  });
});

describe('BillingWebhookService — dunning', () => {
  const failed = buildEvent({
    kind: 'payment_failed',
    customerId: 'cus_1',
    subscriptionId: null,
    amountDueCents: 1200,
    currency: 'usd',
    invoiceUrl: null,
  });

  it('notifies every owner on a failed payment', async () => {
    const { service, provider, notifications } = buildDeps();

    await service.dispatch(provider, failed);

    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u1',
        type_name: 'workspace_payment_failed',
        link_url: '/w/acme/settings/billing',
      }),
    );
  });

  it('resolves a payment by customer when the provider sends no subscription id', async () => {
    const { service, provider, repo } = buildDeps();

    await service.dispatch(provider, failed);

    expect(repo.findByProviderCustomerId).toHaveBeenCalledWith(
      'polar',
      'cus_1',
    );
  });

  it('does not write subscription state on a failed payment', async () => {
    // The paired subscription update sets past_due. Writing it here too would
    // race that event for no benefit.
    const { service, provider, repo } = buildDeps();

    await service.dispatch(provider, failed);

    expect(repo.updateSubscription).not.toHaveBeenCalled();
  });
});

describe('BillingWebhookService — plan-state invalidation', () => {
  it('drops the cached plan state after a subscription write', async () => {
    const { service, provider, entitlements } = buildDeps();

    await service.dispatch(
      provider,
      buildEvent({ kind: 'subscription_changed', subscriptionId: 'sub_1' }),
    );

    expect(entitlements.invalidateWorkspace).toHaveBeenCalledWith('ws-1');
  });

  it('leaves the cache alone when the write was discarded as stale', async () => {
    const { service, provider, repo, entitlements } = buildDeps();
    repo.updateSubscription.mockResolvedValue(null);

    await service.dispatch(
      provider,
      buildEvent({ kind: 'subscription_changed', subscriptionId: 'sub_1' }),
    );

    expect(entitlements.invalidateWorkspace).not.toHaveBeenCalled();
  });

  it('drops the cached plan state when a subscription ends', async () => {
    const { service, provider, entitlements } = buildDeps();

    await service.dispatch(
      provider,
      buildEvent({
        kind: 'subscription_ended',
        subscriptionId: 'sub_1',
        canceledAt: '2026-09-10T00:00:00.000Z',
      }),
    );

    expect(entitlements.invalidateWorkspace).toHaveBeenCalledWith('ws-1');
  });

  it('still processes the event when invalidation fails', async () => {
    // The write already happened and the cache expires on its own; failing
    // the event would only make the provider retry a finished write.
    const { service, provider, entitlements } = buildDeps();
    entitlements.invalidateWorkspace.mockRejectedValue(new Error('redis down'));

    await expect(
      service.dispatch(
        provider,
        buildEvent({ kind: 'subscription_changed', subscriptionId: 'sub_1' }),
      ),
    ).resolves.toBe('processed');
  });

  it('does not invalidate on a payment event that writes only metadata', async () => {
    const { service, provider, repo, entitlements } = buildDeps({
      record: buildRecord({ metadata: { dunning_since: '2026-09-01' } }),
    });

    await service.dispatch(
      provider,
      buildEvent({
        kind: 'payment_succeeded',
        customerId: 'cus_1',
        subscriptionId: 'sub_1',
      }),
    );

    expect(repo.updateSubscription).toHaveBeenCalled();
    expect(entitlements.invalidateWorkspace).not.toHaveBeenCalled();
  });
});

describe('BillingWebhookService — complimentary plans are out of reach', () => {
  it('never writes a comp column, whatever the event', async () => {
    // A comp lives on the workspaces row; a webhook that could touch it could
    // clear a comp a staff member granted.
    const events = [
      buildEvent({ kind: 'subscription_changed', subscriptionId: 'sub_1' }),
      buildEvent({
        kind: 'subscription_ended',
        subscriptionId: 'sub_1',
        canceledAt: '2026-09-10T00:00:00.000Z',
      }),
      buildEvent({
        kind: 'checkout_completed',
        workspaceId: 'ws-1',
        subscriptionId: 'sub_1',
        customerId: 'cus_1',
      }),
    ];
    for (const event of events) {
      const { service, provider, repo } = buildDeps({
        record: buildRecord({ billing_provider: 'polar' }),
      });
      await service.dispatch(provider, event);
      expect(repo.updateSubscription).toHaveBeenCalled();
      for (const [, patch] of repo.updateSubscription.mock.calls) {
        for (const key of COMP_KEYS) {
          expect(patch).not.toHaveProperty(key);
        }
      }
    }
  });
});
