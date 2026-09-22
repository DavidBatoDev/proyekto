/* eslint-disable @typescript-eslint/unbound-method -- Handler references are metadata lookup targets, never invoked. */
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { AdminController } from './admin.controller';

function guards(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[]) ?? [];
}

describe('AdminController guards', () => {
  it('authenticates every route', () => {
    expect(guards(AdminController)).toEqual([SupabaseAuthGuard]);
  });

  it.each(['grantAdmin', 'revokeAdmin'] as const)(
    '%s needs a super admin, checked after AdminGuard attaches the profile',
    (handler) => {
      // Without this a support admin could grant themselves super_admin and
      // walk through every super-admin gate.
      expect(guards(AdminController.prototype[handler])).toEqual([
        AdminGuard,
        SuperAdminGuard,
      ]);
    },
  );

  it('leaves the other admin routes open to any active admin', () => {
    expect(guards(AdminController.prototype.listAdmins)).toEqual([AdminGuard]);
    expect(guards(AdminController.prototype.listApplications)).toEqual([
      AdminGuard,
    ]);
  });
});
