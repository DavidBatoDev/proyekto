import { UsersService } from './users.service';
import type { RedisDataCacheService } from '../../../common/cache/redis-data-cache.service';
import type { UsersRepository } from './repositories/users.repository.interface';
import type { UpdateAppearancePreferencesDto } from './dto/appearance-preferences.dto';

/**
 * Returns the stub alongside its mocks so assertions reference the local
 * functions rather than reading them back off the object, which trips
 * @typescript-eslint/unbound-method.
 */
function cacheStub() {
  const del = jest.fn(() => Promise.resolve(undefined));
  const rememberJson = jest.fn(
    (_key: string, _ttl: number, loader: () => unknown) => loader(),
  );
  const getAuthTtlSeconds = jest.fn(() => 60);
  const service = {
    del,
    rememberJson,
    getAuthTtlSeconds,
  } as unknown as RedisDataCacheService;
  return { service, del, rememberJson };
}

describe('UsersService appearance preferences', () => {
  it('normalizes colors before writing through the repository', async () => {
    const updateAppearancePreferences = jest.fn(
      async (_id, appearance) => appearance,
    );
    const repository = {
      updateAppearancePreferences,
    } as unknown as UsersRepository;
    const service = new UsersService(repository, cacheStub().service);
    const input: UpdateAppearancePreferencesDto = {
      version: 1,
      theme: 'custom',
      custom: {
        accent: '#6d78d5',
        background: '#ffffff',
        contrast: 30,
        sidebar: {
          enabled: true,
          accent: '#123abc',
          background: '#101112',
          contrast: 42,
        },
      },
    };

    await service.updateAppearancePreferences('user-1', input);

    expect(updateAppearancePreferences).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        custom: expect.objectContaining({
          accent: '#6D78D5',
          background: '#FFFFFF',
          sidebar: expect.objectContaining({ accent: '#123ABC' }),
        }),
      }),
    );
  });

  it('evicts the cached appearance so the next read cannot serve the old theme', async () => {
    const { service: cache, del } = cacheStub();
    const repository = {
      updateAppearancePreferences: jest.fn((_id: string, appearance: unknown) =>
        Promise.resolve(appearance),
      ),
    } as unknown as UsersRepository;
    const service = new UsersService(repository, cache);

    // normalizeAppearancePreferences dereferences `custom` unconditionally, so
    // the payload has to be complete even though this test only cares about the
    // cache call that follows.
    await service.updateAppearancePreferences('user-1', {
      version: 1,
      theme: 'custom',
      custom: {
        accent: '#6d78d5',
        background: '#ffffff',
        contrast: 30,
        sidebar: {
          enabled: true,
          accent: '#123abc',
          background: '#101112',
          contrast: 42,
        },
      },
    } as UpdateAppearancePreferencesDto);

    expect(del).toHaveBeenCalledWith(
      'cache:v1:profiles:appearance:user:user-1',
    );
  });

  it('reads appearance through the cache, hitting the repository only on a miss', async () => {
    const { service: cache, rememberJson } = cacheStub();
    const findAppearancePreferences = jest.fn(() =>
      Promise.resolve({ version: 1, theme: 'dark' }),
    );
    const repository = {
      findAppearancePreferences,
    } as unknown as UsersRepository;
    const service = new UsersService(repository, cache);

    const result = await service.getAppearancePreferences('user-1');

    expect(rememberJson).toHaveBeenCalledWith(
      'cache:v1:profiles:appearance:user:user-1',
      60,
      expect.any(Function),
      expect.objectContaining({
        indexKey: 'cache:v1:index:profiles:appearance',
      }),
    );
    expect(findAppearancePreferences).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ version: 1, theme: 'dark' });
  });
});
