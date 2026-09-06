/* eslint-disable @typescript-eslint/unbound-method -- Handler references are metadata lookup targets, never invoked. */
import type { ExecutionContext } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ThrottlerException, ThrottlerModule } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import { AiContextController } from '../ai-context.controller';
import { AiContextThrottlerGuard } from './ai-context-throttler.guard';

function requestContext(
  ip: string,
  user?: AuthenticatedUser,
): ExecutionContext {
  return {
    getClass: () => AiContextController,
    getHandler: () => AiContextController.prototype.resolveRefs,
    switchToHttp: () => ({
      getRequest: () => ({ ip, user, headers: {} }),
      getResponse: () => ({ header: () => undefined }),
    }),
  } as unknown as ExecutionContext;
}

describe('AiContextThrottlerGuard actor buckets', () => {
  let module: TestingModule;
  let guard: AiContextThrottlerGuard;

  beforeEach(async () => {
    // Use Nest DI and the real in-memory throttler; no database is involved.
    module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ limit: 100, ttl: 60_000 }])],
      providers: [AiContextThrottlerGuard],
    }).compile();
    await module.init();
    guard = module.get(AiContextThrottlerGuard);
  });

  afterEach(async () => {
    await module.close();
  });

  async function consumeQuota(context: ExecutionContext): Promise<void> {
    for (let count = 0; count < 60; count += 1) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }
  }

  it('gives distinct users separate quotas behind the same IP', async () => {
    const first = requestContext('10.0.0.1', { id: 'user-a' });
    await consumeQuota(first);

    await expect(guard.canActivate(first)).rejects.toBeInstanceOf(
      ThrottlerException,
    );
    await expect(
      guard.canActivate(requestContext('10.0.0.1', { id: 'user-b' })),
    ).resolves.toBe(true);
  });

  it('uses the same quota for one user arriving from different IPs', async () => {
    await consumeQuota(requestContext('10.0.0.1', { id: 'user-a' }));

    await expect(
      guard.canActivate(requestContext('10.0.0.2', { id: 'user-a' })),
    ).rejects.toBeInstanceOf(ThrottlerException);
  });

  it('falls back to the IP when no authenticated user is attached', async () => {
    await consumeQuota(requestContext('10.0.0.1'));

    await expect(
      guard.canActivate(requestContext('10.0.0.1')),
    ).rejects.toBeInstanceOf(ThrottlerException);
    await expect(guard.canActivate(requestContext('10.0.0.2'))).resolves.toBe(
      true,
    );
  });

  it('uses the authenticated guest profile id for a separate quota', async () => {
    await consumeQuota(
      requestContext('10.0.0.1', { id: 'guest-a', is_guest: true }),
    );

    await expect(
      guard.canActivate(
        requestContext('10.0.0.2', { id: 'guest-a', is_guest: true }),
      ),
    ).rejects.toBeInstanceOf(ThrottlerException);
    await expect(
      guard.canActivate(
        requestContext('10.0.0.1', { id: 'guest-b', is_guest: true }),
      ),
    ).resolves.toBe(true);
  });
});
