import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Reflector } from '@nestjs/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as jwt from 'jsonwebtoken';
import type { RevokedUsersService } from '../auth/revoked-users.service';
import { SupabaseAuthGuard } from './supabase-auth.guard';

const SECRET = 'super-secret-test-value';

function buildContext(headers: Record<string, string>) {
  const request = { headers } as {
    headers: Record<string, string>;
    user?: unknown;
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as Parameters<SupabaseAuthGuard['canActivate']>[0];
  return { ctx, request };
}

function buildGuard(opts: {
  secret?: string;
  getUser?: jest.Mock;
  revoked?: boolean;
}) {
  const getUser = opts.getUser ?? jest.fn();
  const client = { auth: { getUser } } as unknown as SupabaseClient;
  const admin = {} as SupabaseClient;
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;
  const config = {
    get: jest.fn().mockReturnValue(opts.secret),
  } as unknown as ConfigService;
  const isRevoked = jest.fn().mockResolvedValue(opts.revoked ?? false);
  const revokedUsers = { isRevoked } as unknown as RevokedUsersService;
  return {
    guard: new SupabaseAuthGuard(
      client,
      admin,
      reflector,
      config,
      revokedUsers,
    ),
    getUser,
    isRevoked,
  };
}

describe('SupabaseAuthGuard local JWT verification', () => {
  it('verifies a valid token locally without calling GoTrue', async () => {
    const { guard, getUser } = buildGuard({ secret: SECRET });
    const token = jwt.sign({ sub: 'user-1', email: 'a@b.com' }, SECRET, {
      algorithm: 'HS256',
    });
    const { ctx, request } = buildContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1', email: 'a@b.com' });
    expect(getUser).not.toHaveBeenCalled();
  });

  it('falls back to network verification when no secret is configured', async () => {
    const getUser = jest.fn().mockResolvedValue({
      data: { user: { id: 'user-2', email: 'c@d.com' } },
      error: null,
    });
    const { guard } = buildGuard({ secret: undefined, getUser });
    const token = jwt.sign({ sub: 'user-2' }, 'anything', {
      algorithm: 'HS256',
    });
    const { ctx, request } = buildContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect((request.user as { id: string }).id).toBe('user-2');
  });

  it('rejects an expired token locally without a network call', async () => {
    const { guard, getUser } = buildGuard({ secret: SECRET });
    const token = jwt.sign(
      { sub: 'user-3', exp: Math.floor(Date.now() / 1000) - 60 },
      SECRET,
      { algorithm: 'HS256' },
    );
    const { ctx } = buildContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(getUser).not.toHaveBeenCalled();
  });

  it('falls back to network verification when the secret is wrong', async () => {
    const getUser = jest.fn().mockResolvedValue({
      data: { user: { id: 'user-4', email: 'e@f.com' } },
      error: null,
    });
    const { guard } = buildGuard({ secret: SECRET, getUser });
    const token = jwt.sign({ sub: 'user-4' }, 'a-different-secret', {
      algorithm: 'HS256',
    });
    const { ctx, request } = buildContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect((request.user as { id: string }).id).toBe('user-4');
  });
});

/**
 * Deleting an account cannot invalidate an access token that has already been
 * issued — the signature stays valid until `jwt_expiry` (an hour). The local
 * fast path never touches the database, so without these checks a deleted user
 * keeps a working API session. This is the regression test for that.
 */
describe('SupabaseAuthGuard revocation', () => {
  it('rejects a deleted user on the LOCAL fast path', async () => {
    const { guard, getUser, isRevoked } = buildGuard({
      secret: SECRET,
      revoked: true,
    });
    const token = jwt.sign({ sub: 'gone-1' }, SECRET, { algorithm: 'HS256' });
    const { ctx, request } = buildContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(isRevoked).toHaveBeenCalledWith('gone-1');
    // The whole point: this must not depend on the network path running.
    expect(getUser).not.toHaveBeenCalled();
    expect(request.user).toBeUndefined();
  });

  it('rejects a deleted user on the GoTrue fallback path', async () => {
    const getUser = jest
      .fn()
      .mockResolvedValue({ data: { user: { id: 'gone-2' } }, error: null });
    const { guard, isRevoked } = buildGuard({
      secret: undefined,
      getUser,
      revoked: true,
    });
    const token = jwt.sign({ sub: 'gone-2' }, 'anything', {
      algorithm: 'HS256',
    });
    const { ctx, request } = buildContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(isRevoked).toHaveBeenCalledWith('gone-2');
    expect(request.user).toBeUndefined();
  });

  it('lets a live user through and checks them exactly once', async () => {
    const { guard, isRevoked } = buildGuard({ secret: SECRET });
    const token = jwt.sign({ sub: 'live-1' }, SECRET, { algorithm: 'HS256' });
    const { ctx, request } = buildContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(isRevoked).toHaveBeenCalledTimes(1);
    expect((request.user as { id: string }).id).toBe('live-1');
  });
});
