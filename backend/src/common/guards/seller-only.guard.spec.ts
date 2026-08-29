import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { SellerOnlyGuard } from './seller-only.guard';

function contextFor(user?: { id: string }) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

/**
 * The seller predicate makes one count-head query per enrollment table, so
 * the stub answers by table name: consultant_profiles then talent_profiles.
 */
function supabaseFor(counts: { consultant: number; talent: number }) {
  const builderFor = (count: number) => {
    const builder = {
      select: jest.fn(() => builder),
      eq: jest.fn(() => builder),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ count, error: null }).then(resolve),
    };
    return builder;
  };
  return {
    from: jest.fn((table: string) =>
      builderFor(
        table === 'consultant_profiles' ? counts.consultant : counts.talent,
      ),
    ),
  } as any;
}

describe('SellerOnlyGuard', () => {
  it('allows a verified consultant with no talent listing', async () => {
    const guard = new SellerOnlyGuard(
      supabaseFor({ consultant: 1, talent: 0 }),
    );
    await expect(guard.canActivate(contextFor({ id: 'u1' }))).resolves.toBe(
      true,
    );
  });

  it('allows an active talent with no consultant enrollment', async () => {
    const guard = new SellerOnlyGuard(
      supabaseFor({ consultant: 0, talent: 1 }),
    );
    await expect(guard.canActivate(contextFor({ id: 'u1' }))).resolves.toBe(
      true,
    );
  });

  it('allows someone who is both', async () => {
    const guard = new SellerOnlyGuard(
      supabaseFor({ consultant: 1, talent: 1 }),
    );
    await expect(guard.canActivate(contextFor({ id: 'u1' }))).resolves.toBe(
      true,
    );
  });

  it('rejects someone who is neither', async () => {
    const guard = new SellerOnlyGuard(
      supabaseFor({ consultant: 0, talent: 0 }),
    );
    await expect(
      guard.canActivate(contextFor({ id: 'u1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unauthenticated request', async () => {
    const guard = new SellerOnlyGuard(
      supabaseFor({ consultant: 1, talent: 1 }),
    );
    await expect(guard.canActivate(contextFor())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
