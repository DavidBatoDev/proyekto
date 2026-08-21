import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { REDIS_CACHE_KEYS } from '../../../common/cache/redis-cache.keys';
import { RedisDataCacheService } from '../../../common/cache/redis-data-cache.service';
export const USERS_REPOSITORY = Symbol('USERS_REPOSITORY');
import type { UsersRepository } from './repositories/users.repository.interface';
import { UpdateUserDto } from './dto/update-user.dto';
import { Profile } from '../../../common/entities';
import {
  type AppearancePreferences,
  normalizeAppearancePreferences,
  UpdateAppearancePreferencesDto,
} from './dto/appearance-preferences.dto';

@Injectable()
export class UsersService {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly usersRepo: UsersRepository,
    private readonly cache: RedisDataCacheService,
  ) {}

  async getMe(userId: string): Promise<Profile> {
    const profile = await this.usersRepo.findById(userId);
    if (!profile) throw new NotFoundException('User not found');
    return profile;
  }

  async updateMe(userId: string, dto: UpdateUserDto): Promise<Profile> {
    return this.usersRepo.update(userId, dto);
  }

  /**
   * Appearance is read on every themed page load and changes only when the user
   * deliberately edits it, so it caches well.
   */
  async getAppearancePreferences(
    userId: string,
  ): Promise<AppearancePreferences | null> {
    return this.cache.rememberJson(
      REDIS_CACHE_KEYS.profileAppearanceByUser(userId),
      this.cache.getAuthTtlSeconds(),
      async () => this.usersRepo.findAppearancePreferences(userId),
      { indexKey: REDIS_CACHE_KEYS.profileAppearanceIndex },
    );
  }

  async updateAppearancePreferences(
    userId: string,
    dto: UpdateAppearancePreferencesDto,
  ) {
    const appearance = normalizeAppearancePreferences(dto);
    const saved = await this.usersRepo.updateAppearancePreferences(
      userId,
      appearance,
    );
    // Evict rather than write through: the shared cache service exposes no
    // public setter, and widening it for one call site is not worth it. Theme
    // edits are rare, so the one extra read on the next request is cheap.
    // `del` already swallows and logs its own failures, so a Redis outage
    // cannot fail the write the user just made.
    await this.cache.del(REDIS_CACHE_KEYS.profileAppearanceByUser(userId));
    return saved;
  }

  async getPublicProfile(id: string): Promise<Partial<Profile>> {
    const profile = await this.usersRepo.findPublicById(id);
    if (!profile) throw new NotFoundException('User not found');
    return profile;
  }
}
