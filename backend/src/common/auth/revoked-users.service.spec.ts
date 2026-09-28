import type { Redis } from '@upstash/redis';
import { RevokedUsersService, revokedUserKey } from './revoked-users.service';

function build(redis: Partial<Redis> | null) {
  return new RevokedUsersService(redis as Redis | null);
}

describe('RevokedUsersService', () => {
  it('reports a revoked user', async () => {
    const get = jest.fn().mockResolvedValue('1');
    const service = build({ get } as Partial<Redis>);
    await expect(service.isRevoked('gone')).resolves.toBe(true);
    expect(get).toHaveBeenCalledWith(revokedUserKey('gone'));
  });

  it('reports a live user', async () => {
    const service = build({
      get: jest.fn().mockResolvedValue(null),
    } as Partial<Redis>);
    await expect(service.isRevoked('live')).resolves.toBe(false);
  });

  it('asks Redis once per user, then serves the negative answer from memory', async () => {
    const get = jest.fn().mockResolvedValue(null);
    const service = build({ get } as Partial<Redis>);

    for (let i = 0; i < 5; i += 1) {
      await expect(service.isRevoked('live')).resolves.toBe(false);
    }

    // The whole reason this service exists rather than a bare Redis GET in the
    // guard: one round-trip per user per minute, not one per request.
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('never re-checks a user once revoked', async () => {
    const get = jest.fn().mockResolvedValue('1');
    const service = build({ get } as Partial<Redis>);

    await service.isRevoked('gone');
    await service.isRevoked('gone');
    await service.isRevoked('gone');

    // Revocation is terminal - an account is never un-deleted.
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('revoking takes effect immediately in-process, without a read', async () => {
    const get = jest.fn().mockResolvedValue(null);
    const set = jest.fn().mockResolvedValue('OK');
    const service = build({ get, set } as Partial<Redis>);

    await service.isRevoked('u'); // caches "not revoked"
    await service.revoke('u');
    await expect(service.isRevoked('u')).resolves.toBe(true);

    expect(set).toHaveBeenCalledWith(revokedUserKey('u'), '1', {
      ex: expect.any(Number),
    });
    // The stale negative must be dropped by revoke(), not waited out.
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('fails OPEN when Redis is unreachable', async () => {
    const service = build({
      get: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
    } as Partial<Redis>);
    // An Upstash outage must not sign the entire product out.
    await expect(service.isRevoked('anyone')).resolves.toBe(false);
  });

  it('does not blow up when Redis is not configured at all', async () => {
    const service = build(null);
    await expect(service.isRevoked('anyone')).resolves.toBe(false);
    await expect(service.revoke('anyone')).resolves.toBeUndefined();
    // Still revoked for the life of this process, which is better than nothing.
    await expect(service.isRevoked('anyone')).resolves.toBe(true);
  });

  it('propagates a Redis write failure so the caller can log it', async () => {
    const service = build({
      set: jest.fn().mockRejectedValue(new Error('redis down')),
    } as Partial<Redis>);
    await expect(service.revoke('u')).rejects.toThrow('redis down');
  });
});
