import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConsultantOnlyGuard } from './consultant-only.guard';

function contextFor(user?: { id: string }) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

function supabaseFor(count: number, error: { message: string } | null = null) {
  const builder = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ count, error }).then(resolve),
  };
  return { from: jest.fn(() => builder) } as any;
}

describe('ConsultantOnlyGuard', () => {
  it('allows a verified consultant', async () => {
    const guard = new ConsultantOnlyGuard(supabaseFor(1));
    await expect(guard.canActivate(contextFor({ id: 'user-1' }))).resolves.toBe(
      true,
    );
  });

  it.each([
    { count: 0, error: null },
    { count: 1, error: { message: 'db down' } },
  ])('rejects without active enrollment: %p', async ({ count, error }) => {
    const guard = new ConsultantOnlyGuard(supabaseFor(count, error));
    await expect(
      guard.canActivate(contextFor({ id: 'user-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unauthenticated request', async () => {
    const guard = new ConsultantOnlyGuard(supabaseFor(0));
    await expect(guard.canActivate(contextFor())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
