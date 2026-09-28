/* eslint-disable @typescript-eslint/unbound-method --
 * The entitlements double is a jest.Mocked object; passing its members to
 * expect() is an identity check on the mock, never a call, so `this` scoping
 * is irrelevant.
 */
import { allowAllEntitlements } from '../entitlements/__entitlements-test-kit-spec';
import {
  buildFakeProvider,
  buildLiveSubscription,
  buildRecord,
  buildRegistry,
} from './__billing-test-kit-spec';
import { BillingReconcileService } from './billing-reconcile.service';
import type { WorkspaceSubscriptionRecord } from './repositories/platform-billing.repository.interface';

function buildDeps(
  record: WorkspaceSubscriptionRecord,
  live = buildLiveSubscription(),
) {
  const provider = buildFakeProvider('polar', live);
  const repo = {
    listReconcilable: jest
      .fn()
      .mockResolvedValueOnce([record])
      .mockResolvedValue([]),
    countSeats: jest.fn().mockResolvedValue(3),
    updateSubscription: jest.fn().mockResolvedValue(record),
    listRetryableEvents: jest.fn().mockResolvedValue([]),
    markEvent: jest.fn().mockResolvedValue(undefined),
    pruneEvents: jest.fn().mockResolvedValue(0),
  };
  const seatSync = { syncSeats: jest.fn().mockResolvedValue(undefined) };
  const webhooks = { replay: jest.fn().mockResolvedValue('processed') };
  const entitlements = allowAllEntitlements();
  const service = new BillingReconcileService(
    buildRegistry(provider) as never,
    repo as never,
    seatSync as never,
    webhooks as never,
    entitlements,
  );
  return { service, repo, entitlements };
}

const COMP_KEYS = [
  'is_discounted_free',
  'discounted_plan',
  'discounted_at',
  'discounted_until',
];

describe('BillingReconcileService — plan state', () => {
  it('drops the cached plan state after repairing a drifted status', async () => {
    const { service, repo, entitlements } = buildDeps(
      buildRecord({ status: 'past_due' }),
    );

    const result = await service.run();

    expect(result.state_repairs).toBe(1);
    expect(repo.updateSubscription).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ status: 'active' }),
      expect.anything(),
    );
    expect(entitlements.invalidateWorkspace).toHaveBeenCalledWith('ws-1');
  });

  it('leaves the cache alone when nothing drifted', async () => {
    const { service, repo, entitlements } = buildDeps(buildRecord());

    await service.run();

    expect(repo.updateSubscription).not.toHaveBeenCalled();
    expect(entitlements.invalidateWorkspace).not.toHaveBeenCalled();
  });

  it('never writes a comp column in a repair', async () => {
    // Reconcile rewrites workspace_subscriptions from the provider; a comp on
    // the workspaces row must survive it untouched.
    const { service, repo } = buildDeps(
      buildRecord({ plan: 'business', status: 'past_due' }),
    );

    await service.run();

    const patch = repo.updateSubscription.mock.calls[0][1];
    for (const key of COMP_KEYS) {
      expect(patch).not.toHaveProperty(key);
    }
  });

  it('counts the repair even when invalidation fails', async () => {
    const { service, entitlements } = buildDeps(
      buildRecord({ status: 'past_due' }),
    );
    entitlements.invalidateWorkspace.mockRejectedValue(new Error('redis down'));

    const result = await service.run();

    expect(result.state_repairs).toBe(1);
    expect(result.failed).toBe(0);
  });
});
