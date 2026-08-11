import { UsersService } from './users.service';
import type { UsersRepository } from './repositories/users.repository.interface';
import type { UpdateAppearancePreferencesDto } from './dto/appearance-preferences.dto';

describe('UsersService appearance preferences', () => {
  it('normalizes colors before writing through the repository', async () => {
    const updateAppearancePreferences = jest.fn(
      async (_id, appearance) => appearance,
    );
    const repository = {
      updateAppearancePreferences,
    } as unknown as UsersRepository;
    const service = new UsersService(repository);
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
});
