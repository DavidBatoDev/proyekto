/* eslint-disable @typescript-eslint/unbound-method -- Handler references are metadata lookup targets, never invoked. */
import 'reflect-metadata';
import { ServiceUnavailableException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import { CACHE_POLICY_PRESETS } from '../../../../common/cache/cache-policy';
import { CACHE_POLICY_METADATA_KEY } from '../../../../common/decorators/cache-policy.decorator';
import { IS_PUBLIC_KEY } from '../../../../common/decorators/public.decorator';
import { AdminGuard } from '../../../../common/guards/admin.guard';
import { SuperAdminGuard } from '../../../../common/guards/super-admin.guard';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import {
  allowAllEntitlements,
  buildSeedKeyRows,
  buildSeedLimitRows,
} from '../__entitlements-test-kit-spec';
import { buildMatrix } from '../entitlements.logic';
import { AdminPlanLimitsController } from './admin-plan-limits.controller';
import { AdminWorkspacesController } from './admin-workspaces.controller';
import { PlansController } from './plans.controller';
import { WorkspaceUsageController } from './workspace-usage.controller';

function guards(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[]) ?? [];
}

function fakeResponse() {
  const headers: Record<string, string> = {};
  const response = {
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  };
  return { response: response as unknown as Response, headers };
}

describe('PlansController', () => {
  it('is public and edge-cached, on a class that still authenticates by default', () => {
    const handler = PlansController.prototype.list;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(CACHE_POLICY_METADATA_KEY, handler)).toBe(
      CACHE_POLICY_PRESETS.PUBLIC_EDGE_SHORT,
    );
    expect(guards(PlansController)).toEqual([SupabaseAuthGuard]);
  });

  it('serves the matrix without staff-only fields', async () => {
    const entitlements = allowAllEntitlements();
    entitlements.getLimitMatrix.mockResolvedValue(
      buildMatrix(buildSeedKeyRows(), buildSeedLimitRows()),
    );
    const { response } = fakeResponse();

    const plans = await new PlansController(entitlements).list(response);

    expect(plans.plans).toEqual(['free', 'pro', 'business', 'enterprise']);
    expect(plans.keys).toHaveLength(18);
    expect(plans.keys[0]).not.toHaveProperty('enforced');
    expect(plans).not.toHaveProperty('drift');
    expect(plans.limits.free.projects).toEqual({
      kind: 'count',
      value: 2,
      per_seat: false,
      display_label: null,
    });
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('answers 503 with no-store when the matrix cannot be read, so the edge never caches the failure', async () => {
    const entitlements = allowAllEntitlements();
    entitlements.getLimitMatrix.mockRejectedValue(
      new Error('relation "plan_limits" does not exist'),
    );
    const { response, headers } = fakeResponse();

    await expect(
      new PlansController(entitlements).list(response),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(headers['Cache-Control']).toBe('no-store');
  });
});

describe('WorkspaceUsageController', () => {
  it('authenticates and is never cached', () => {
    expect(guards(WorkspaceUsageController)).toEqual([SupabaseAuthGuard]);
    expect(
      Reflect.getMetadata(CACHE_POLICY_METADATA_KEY, WorkspaceUsageController),
    ).toBe(CACHE_POLICY_PRESETS.NO_STORE);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        WorkspaceUsageController.prototype.getUsage,
      ),
    ).toBeUndefined();
  });
});

describe('admin controllers', () => {
  it.each([
    ['plan limits', AdminPlanLimitsController],
    ['workspaces', AdminWorkspacesController],
  ])(
    '%s: every route needs an active admin and nothing is cached',
    (_l, controller) => {
      expect(guards(controller)).toEqual([SupabaseAuthGuard, AdminGuard]);
      expect(Reflect.getMetadata(CACHE_POLICY_METADATA_KEY, controller)).toBe(
        CACHE_POLICY_PRESETS.NO_STORE,
      );
    },
  );

  it('opens reads to any admin', () => {
    expect(guards(AdminPlanLimitsController.prototype.get)).toEqual([]);
    expect(guards(AdminWorkspacesController.prototype.list)).toEqual([]);
    expect(guards(AdminWorkspacesController.prototype.get)).toEqual([]);
  });

  it('requires a super admin for every write', () => {
    expect(guards(AdminPlanLimitsController.prototype.update)).toEqual([
      SuperAdminGuard,
    ]);
    expect(guards(AdminWorkspacesController.prototype.setComp)).toEqual([
      SuperAdminGuard,
    ]);
    expect(guards(AdminWorkspacesController.prototype.clearComp)).toEqual([
      SuperAdminGuard,
    ]);
  });

  it('takes the revoke note from the body first, then the query', async () => {
    const admin = {
      clearComp: jest.fn().mockResolvedValue({ workspace: {} }),
    };
    const controller = new AdminWorkspacesController(admin as never);
    const user = { id: 'admin-1' };

    await controller.clearComp('ws', { note: 'body' }, { note: 'query' }, user);
    await controller.clearComp('ws', {}, { note: 'query' }, user);

    expect(admin.clearComp).toHaveBeenNthCalledWith(1, 'ws', 'body', 'admin-1');
    expect(admin.clearComp).toHaveBeenNthCalledWith(
      2,
      'ws',
      'query',
      'admin-1',
    );
  });
});
