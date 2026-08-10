import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConsultantOnlyGuard } from './consultant-only.guard';

function contextFor(user?: { id: string }) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

function supabaseFor(profile: unknown) {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn().mockResolvedValue({ data: profile, error: null }),
  };
  return { from: jest.fn(() => builder) } as any;
}

describe('ConsultantOnlyGuard', () => {
  it('allows only consultant role plus verification', async () => {
    const guard = new ConsultantOnlyGuard(
      supabaseFor({ role: 'consultant', is_consultant_verified: true }),
    );
    await expect(guard.canActivate(contextFor({ id: 'user-1' }))).resolves.toBe(
      true,
    );
  });

  it.each([
    { role: 'consultant', is_consultant_verified: false },
    { role: 'talent', is_consultant_verified: true },
    { role: 'client', is_consultant_verified: true },
  ])('rejects incomplete consultant capability: %p', async (profile) => {
    const guard = new ConsultantOnlyGuard(supabaseFor(profile));
    await expect(
      guard.canActivate(contextFor({ id: 'user-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unauthenticated request', async () => {
    const guard = new ConsultantOnlyGuard(supabaseFor(null));
    await expect(guard.canActivate(contextFor())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
