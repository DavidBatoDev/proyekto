import { ForbiddenException } from '@nestjs/common';
import { SuperAdminGuard } from './super-admin.guard';

function contextFor(adminProfile?: {
  access_level?: string;
  is_active?: boolean;
}) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'u1' }, adminProfile }),
    }),
  } as any;
}

describe('SuperAdminGuard', () => {
  const guard = new SuperAdminGuard();

  it('allows an active super_admin', () => {
    expect(
      guard.canActivate(
        contextFor({ access_level: 'super_admin', is_active: true }),
      ),
    ).toBe(true);
  });

  it.each(['support', 'moderator', 'admin', ''])(
    'rejects an active %p admin',
    (accessLevel) => {
      expect(() =>
        guard.canActivate(
          contextFor({ access_level: accessLevel, is_active: true }),
        ),
      ).toThrow(ForbiddenException);
    },
  );

  it('rejects an inactive super_admin', () => {
    expect(() =>
      guard.canActivate(
        contextFor({ access_level: 'super_admin', is_active: false }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects a request AdminGuard never ran on', () => {
    // No adminProfile means AdminGuard was left off the route; failing closed
    // keeps a misordered @UseGuards from opening a super-admin write.
    expect(() => guard.canActivate(contextFor())).toThrow(ForbiddenException);
  });
});
