import {
  buildFakeProvider,
  buildLiveSubscription,
  buildRecord,
  buildRegistry,
  type FakeProvider,
} from './__billing-test-kit-spec';
import type { WorkspaceSubscriptionRecord } from './repositories/platform-billing.repository.interface';
import { prorationFor, SeatSyncService } from './seat-sync.service';

function buildRepo(
  subscription: WorkspaceSubscriptionRecord | null,
  seats: number,
) {
  return {
    findByWorkspaceId: jest.fn().mockResolvedValue(subscription),
    countSeats: jest.fn().mockResolvedValue(seats),
    updateSubscription: jest.fn().mockResolvedValue(subscription),
  };
}

function providerBilling(quantity: number, id: FakeProvider['id'] = 'polar') {
  return buildFakeProvider(id, buildLiveSubscription({ quantity }));
}

function buildService(
  providers: FakeProvider[],
  repo: unknown,
  extraConfig: Record<string, unknown> = {},
) {
  const config = { get: (key: string) => extraConfig[key] };
  return new SeatSyncService(
    buildRegistry(...providers) as never,
    repo as never,
    config as never,
  );
}

describe('prorationFor — the Linear seat policy', () => {
  /**
   * This table is the billing contract. It reproduces Linear's published
   * behaviour, and each row is a promise made in user-facing copy before the
   * click, so a change here is a change to what customers were told. It is
   * provider-neutral: each adapter's spec pins how it spells these.
   */
  it.each([
    ['month', 5, 6, 'next_invoice'],
    ['month', 6, 5, 'next_invoice'],
    ['year', 5, 6, 'charge_now'],
    ['year', 6, 5, 'credit_next_invoice'],
  ] as const)(
    '%s billing, %i billed -> %i seats: %s',
    (interval, billed, seats, expected) => {
      expect(prorationFor(interval, seats, billed)).toBe(expected);
    },
  );

  it('treats an unknown interval as monthly: never charge mid-cycle by accident', () => {
    expect(prorationFor(null, 6, 5)).toBe('next_invoice');
  });
});

describe('SeatSyncService.syncSeats', () => {
  it.each([
    ['month', 5, 6, 'next_invoice'],
    ['month', 6, 5, 'next_invoice'],
    ['year', 5, 6, 'charge_now'],
    ['year', 6, 5, 'credit_next_invoice'],
  ] as const)(
    'pushes the true count with the policy proration (%s, %i -> %i)',
    async (interval, billed, seats, proration) => {
      const provider = providerBilling(billed);
      const service = buildService(
        [provider],
        buildRepo(buildRecord({ billing_interval: interval }), seats),
      );

      expect(await service.syncSeats('ws-1', 'member_joined')).toEqual({
        synced: true,
        from: billed,
        to: seats,
        proration,
      });
      expect(provider.updateSeatQuantity).toHaveBeenCalledWith({
        subscriptionId: 'sub_1',
        seatItemId: null,
        quantity: seats,
        proration,
      });
    },
  );

  it('syncs through the provider that owns the row, not the active one', async () => {
    // A workspace that subscribed through Stripe must keep syncing through
    // Stripe after new sales move to another provider.
    const active = providerBilling(5, 'polar');
    const owning = providerBilling(5, 'stripe');
    const service = buildService(
      [active, owning],
      buildRepo(buildRecord({ billing_provider: 'stripe' }), 6),
    );

    await service.syncSeats('ws-1', 'member_joined');

    expect(owning.updateSeatQuantity).toHaveBeenCalled();
    expect(active.updateSeatQuantity).not.toHaveBeenCalled();
  });

  it('falls back to the stored seat item when the live read has none', async () => {
    const provider = buildFakeProvider(
      'stripe',
      buildLiveSubscription({ quantity: 5, seatItemId: null }),
    );
    const service = buildService(
      [provider],
      buildRepo(
        buildRecord({
          billing_provider: 'stripe',
          provider_subscription_item_id: 'si_1',
        }),
        6,
      ),
    );

    await service.syncSeats('ws-1', 'member_joined');

    expect(provider.updateSeatQuantity).toHaveBeenCalledWith(
      expect.objectContaining({ seatItemId: 'si_1' }),
    );
  });
});

describe('SeatSyncService.syncSeats — when it must not call the provider', () => {
  it('does nothing when the quantity already matches', async () => {
    const provider = providerBilling(6);
    const service = buildService([provider], buildRepo(buildRecord(), 6));

    expect(await service.syncSeats('ws-1', 'reconcile')).toEqual({
      synced: false,
      skipped: 'in_sync',
    });
    expect(provider.updateSeatQuantity).not.toHaveBeenCalled();
  });

  it('does nothing on the free plan — free never touches a provider at all', async () => {
    const provider = providerBilling(0);
    const service = buildService(
      [provider],
      buildRepo(
        buildRecord({ plan: 'free', provider_subscription_id: null }),
        3,
      ),
    );

    expect(await service.syncSeats('ws-1', 'member_joined')).toEqual({
      synced: false,
      skipped: 'no_paid_subscription',
    });
    expect(provider.getSubscription).not.toHaveBeenCalled();
  });

  it('does nothing when there is no subscription row', async () => {
    const service = buildService([providerBilling(0)], buildRepo(null, 3));

    expect(await service.syncSeats('ws-1', 'member_joined')).toEqual({
      synced: false,
      skipped: 'no_paid_subscription',
    });
  });

  it('refuses to bill zero seats', async () => {
    // Unreachable through the API thanks to assertNotLastOwner, but reachable
    // by deleting the last owner's profile, which CASCADEs the membership away.
    const provider = providerBilling(4);
    const service = buildService([provider], buildRepo(buildRecord(), 0));

    expect(await service.syncSeats('ws-1', 'member_removed')).toEqual({
      synced: false,
      skipped: 'zero_seats',
    });
    expect(provider.updateSeatQuantity).not.toHaveBeenCalled();
  });

  it("does nothing when the row's provider is not configured here", async () => {
    const service = buildService([], buildRepo(buildRecord(), 6));

    expect(await service.syncSeats('ws-1', 'member_joined')).toEqual({
      synced: false,
      skipped: 'disabled',
    });
  });
});

describe('SeatSyncService.syncSeatsBounded', () => {
  /**
   * The membership row is already committed when this runs. If it threw, a
   * provider outage would turn "accept an invitation" into a 500 — billing
   * infrastructure taking the product down with it.
   */
  it('resolves rather than rejecting when the provider fails', async () => {
    const provider = providerBilling(5);
    provider.getSubscription.mockRejectedValue(new Error('provider is down'));
    const service = buildService([provider], buildRepo(buildRecord(), 6));

    await expect(
      service.syncSeatsBounded('ws-1', 'member_joined'),
    ).resolves.toBeUndefined();
  });

  it('flags the row so the reconcile cron picks up what it could not push', async () => {
    const provider = providerBilling(5);
    provider.getSubscription.mockRejectedValue(new Error('provider is down'));
    const repo = buildRepo(buildRecord(), 6);
    const service = buildService([provider], repo);

    await service.syncSeatsBounded('ws-1', 'member_joined');

    expect(repo.updateSubscription).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({
        metadata: expect.objectContaining({ seat_sync_pending: true }),
      }),
      expect.anything(),
    );
  });

  it('gives up at the bound rather than holding the response open', async () => {
    // Cloud Run can freeze instance CPU once a response is sent, so the sync is
    // bounded rather than detached — but the bound must actually release the
    // request, not merely be documented.
    const provider = providerBilling(5);
    // Released in `finally` so the pending call cannot outlive the test and
    // keep the Jest worker alive.
    let release: () => void = () => undefined;
    provider.getSubscription.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(buildLiveSubscription({ quantity: 5 }));
        }),
    );
    const service = buildService([provider], buildRepo(buildRecord(), 6), {
      PLATFORM_BILLING_SEAT_SYNC_BOUND_MS: 20,
    });

    const started = Date.now();
    try {
      await service.syncSeatsBounded('ws-1', 'member_joined');
      expect(Date.now() - started).toBeLessThan(1_000);
    } finally {
      release();
    }
  });
});
