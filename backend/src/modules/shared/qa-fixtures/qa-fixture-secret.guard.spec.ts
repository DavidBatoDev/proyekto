import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { QaFixtureSecretGuard } from './qa-fixture-secret.guard';

function context(secret?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { 'x-qa-secret': secret } }),
    }),
  } as unknown as ExecutionContext;
}

describe('QaFixtureSecretGuard', () => {
  it('looks absent while production QA is disabled', () => {
    const guard = new QaFixtureSecretGuard({
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);
    expect(() => guard.canActivate(context('secret'))).toThrow(
      NotFoundException,
    );
  });

  it('rejects an invalid secret', () => {
    const guard = new QaFixtureSecretGuard({
      get: jest.fn((key: string) =>
        key === 'PRODUCTION_QA_ENABLED' ? 'true' : 'correct',
      ),
    } as unknown as ConfigService);
    expect(() => guard.canActivate(context('wrong'))).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts the configured secret', () => {
    const guard = new QaFixtureSecretGuard({
      get: jest.fn((key: string) =>
        key === 'PRODUCTION_QA_ENABLED' ? 'true' : 'correct',
      ),
    } as unknown as ConfigService);
    expect(guard.canActivate(context('correct'))).toBe(true);
  });
});
