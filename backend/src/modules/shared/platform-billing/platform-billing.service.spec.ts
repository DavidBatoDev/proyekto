/* eslint-disable @typescript-eslint/unbound-method --
 * The entitlements double is a jest.Mocked object; passing its members to
 * expect() is an identity check on the mock, never a call, so `this` scoping
 * is irrelevant.
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { allowAllEntitlements } from '../entitlements/__entitlements-test-kit-spec';
import type {
  CompPlan,
  PlanId,
  PlanSource,
  WorkspacePlanState,
} from '../entitlements/entitlement-keys';
import {
  buildFakeProvider,
  buildRecord,
  buildRegistry,
} from './__billing-test-kit-spec';
import { PlatformBillingService } from './platform-billing.service';
import type { WorkspaceSubscriptionRecord } from './repositories/platform-billing.repository.interface';

function planState(
  overrides: {
    effective?: PlanId;
    source?: PlanSource;
    comp?: { plan: CompPlan; active?: boolean; until?: string | null } | null;
  } = {},
): WorkspacePlanState {
  const comp = overrides.comp ?? null;
  return {
    workspace_id: 'ws-1',
    workspace_name: 'Acme',
    workspace_slug: 'acme',
    effective_plan: overrides.effective ?? 'free',
    plan_source: overrides.source ?? 'default',
    subscription_plan: 'free',
    subscription_status: null,
    has_provider_subscription: false,
    complimentary: comp
      ? {
          plan: comp.plan,
          since: '2026-09-01T00:00:00.000Z',
          until: comp.until ?? null,
          active: comp.active ?? true,
        }
      : null,
  };
}

function buildDeps(
  options: {
    record?: WorkspaceSubscriptionRecord;
    state?: WorkspacePlanState | Error;
  } = {},
) {
  const provider = buildFakeProvider('polar');
  const record =
    options.record ??
    buildRecord({
      plan: 'free',
      status: 'active',
      provider_customer_id: null,
      provider_subscription_id: null,
      provider_price_id: null,
      billing_interval: null,
    });
  const repo = {
    ensureRow: jest.fn().mockResolvedValue(record),
    countSeats: jest.fn().mockResolvedValue(4),
    listOwners: jest
      .fn()
      .mockResolvedValue([{ user_id: 'owner-1', email: 'owner@acme.test' }]),
    updateSubscription: jest.fn().mockResolvedValue(record),
    findByWorkspaceId: jest.fn().mockResolvedValue(record),
  };
  const config = { get: jest.fn(() => 'https://app.proyekto.test') };
  const workspace = { id: 'ws-1', name: 'Acme', slug: 'acme' };
  const workspaces = {
    fetchWorkspaceOrThrow: jest.fn().mockResolvedValue(workspace),
    assertOwner: jest.fn().mockResolvedValue(undefined),
    assertCanManageWorkspace: jest.fn().mockResolvedValue('owner'),
  };
  const entitlements = allowAllEntitlements();
  const state = options.state ?? planState();
  if (state instanceof Error) {
    entitlements.getEffectivePlan.mockRejectedValue(state);
  } else {
    entitlements.getEffectivePlan.mockResolvedValue(state);
  }
  const service = new PlatformBillingService(
    buildRegistry(provider) as never,
    repo as never,
    config as never,
    workspaces as never,
    entitlements,
  );
  return { service, provider, repo, workspaces, entitlements };
}

describe('PlatformBillingService — checkout on a complimentary workspace', () => {
  it('refuses a plan at the same tier as an active comp with 409 workspace_complimentary', async () => {
    const { service, provider } = buildDeps({
      state: planState({
        effective: 'business',
        source: 'complimentary',
        comp: { plan: 'business' },
      }),
    });

    const error = await service
      .createCheckoutSession('ws-1', 'owner-1', {
        plan: 'business',
        interval: 'month',
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'workspace_complimentary',
      complimentary_plan: 'business',
    });
    expect(provider.createCheckout).not.toHaveBeenCalled();
  });

  it('refuses a plan below an active comp', async () => {
    const { service } = buildDeps({
      state: planState({
        effective: 'business',
        source: 'complimentary',
        comp: { plan: 'business' },
      }),
    });

    await expect(
      service.createCheckoutSession('ws-1', 'owner-1', {
        plan: 'pro',
        interval: 'year',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('sells a plan above the comp; once bought it wins by rank', async () => {
    const { service, provider } = buildDeps({
      state: planState({
        effective: 'pro',
        source: 'complimentary',
        comp: { plan: 'pro' },
      }),
    });

    await expect(
      service.createCheckoutSession('ws-1', 'owner-1', {
        plan: 'business',
        interval: 'month',
      }),
    ).resolves.toEqual({ url: 'https://pay.example/checkout' });
    expect(provider.createCheckout).toHaveBeenCalled();
  });

  it('ignores a lapsed comp', async () => {
    const { service, provider } = buildDeps({
      state: planState({ comp: { plan: 'business', active: false } }),
    });

    await service.createCheckoutSession('ws-1', 'owner-1', {
      plan: 'pro',
      interval: 'month',
    });

    expect(provider.createCheckout).toHaveBeenCalled();
  });

  it('reads the plan fresh, past the cache, so a comp granted a moment ago counts', async () => {
    const { service, entitlements } = buildDeps();

    await service.createCheckoutSession('ws-1', 'owner-1', {
      plan: 'pro',
      interval: 'month',
    });

    expect(entitlements.getEffectivePlan).toHaveBeenCalledWith('ws-1', {
      fresh: true,
    });
  });

  it('checks ownership before revealing anything about the plan', async () => {
    const { service, workspaces, entitlements } = buildDeps({
      state: planState({ comp: { plan: 'business' } }),
    });
    workspaces.assertOwner.mockRejectedValue(new ForbiddenException());

    await expect(
      service.createCheckoutSession('ws-1', 'admin-1', {
        plan: 'pro',
        interval: 'month',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(entitlements.getEffectivePlan).not.toHaveBeenCalled();
  });

  it('lets the checkout through when the plan lookup fails', async () => {
    // A database without the plan-limits tables has no comps to protect.
    const { service, provider } = buildDeps({
      state: new Error('relation "plan_limits" does not exist'),
    });

    await service.createCheckoutSession('ws-1', 'owner-1', {
      plan: 'pro',
      interval: 'month',
    });

    expect(provider.createCheckout).toHaveBeenCalled();
  });
});

describe('PlatformBillingService — summary', () => {
  it('reports the effective plan and the comp next to the billed plan', async () => {
    const { service } = buildDeps({
      state: planState({
        effective: 'business',
        source: 'complimentary',
        comp: { plan: 'business', until: '2027-01-01T00:00:00.000Z' },
      }),
    });

    const summary = await service.getSummary('ws-1', 'owner-1');

    expect(summary).toMatchObject({
      plan: 'free',
      effective_plan: 'business',
      plan_source: 'complimentary',
      complimentary: {
        plan: 'business',
        since: '2026-09-01T00:00:00.000Z',
        until: '2027-01-01T00:00:00.000Z',
        active: true,
      },
      has_live_subscription: false,
    });
  });

  it('offers only plans ranked above an active comp', async () => {
    const pro = buildDeps({
      state: planState({
        effective: 'pro',
        source: 'complimentary',
        comp: { plan: 'pro' },
      }),
    });
    expect(
      (await pro.service.getSummary('ws-1', 'owner-1')).purchasable_plans,
    ).toEqual(['business']);

    const business = buildDeps({
      state: planState({
        effective: 'business',
        source: 'complimentary',
        comp: { plan: 'business' },
      }),
    });
    expect(
      (await business.service.getSummary('ws-1', 'owner-1')).purchasable_plans,
    ).toEqual([]);
  });

  it('offers every plan when the comp has lapsed', async () => {
    const { service } = buildDeps({
      state: planState({ comp: { plan: 'business', active: false } }),
    });

    const summary = await service.getSummary('ws-1', 'owner-1');

    expect(summary.purchasable_plans).toEqual(['pro', 'business']);
    expect(summary.complimentary).toMatchObject({ active: false });
  });

  it('flags a live provider subscription', async () => {
    const { service } = buildDeps({
      record: buildRecord({ plan: 'pro', status: 'past_due' }),
      state: planState({ effective: 'pro', source: 'subscription' }),
    });

    const summary = await service.getSummary('ws-1', 'owner-1');

    expect(summary.has_live_subscription).toBe(true);
    expect(summary.effective_plan).toBe('pro');
  });

  it('does not call a canceled subscription live', async () => {
    const { service } = buildDeps({
      record: buildRecord({ plan: 'pro', status: 'canceled' }),
    });

    expect(
      (await service.getSummary('ws-1', 'owner-1')).has_live_subscription,
    ).toBe(false);
  });

  it('falls back to the billed plan when the plan state cannot be read', async () => {
    const { service } = buildDeps({
      record: buildRecord({ plan: 'pro', status: 'active' }),
      state: new Error('relation "plan_limits" does not exist'),
    });

    const summary = await service.getSummary('ws-1', 'owner-1');

    expect(summary).toMatchObject({
      effective_plan: 'pro',
      plan_source: 'subscription',
      complimentary: null,
    });
  });
});
