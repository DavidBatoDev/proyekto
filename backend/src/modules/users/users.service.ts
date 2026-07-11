import { Inject, Injectable, NotFoundException } from '@nestjs/common';
export const USERS_REPOSITORY = Symbol('USERS_REPOSITORY');
import type { UsersRepository } from './repositories/users.repository.interface';
import { UpdateUserDto } from './dto/update-user.dto';
import { Profile } from '../../common/entities';
import {
  normalizeAppearancePreferences,
  UpdateAppearancePreferencesDto,
} from './dto/appearance-preferences.dto';

@Injectable()
export class UsersService {
  constructor(
    @Inject(USERS_REPOSITORY) private readonly usersRepo: UsersRepository,
  ) {}

  async getMe(userId: string): Promise<Profile> {
    const profile = await this.usersRepo.findById(userId);
    if (!profile) throw new NotFoundException('User not found');
    return profile;
  }

  async updateMe(userId: string, dto: UpdateUserDto): Promise<Profile> {
    return this.usersRepo.update(userId, dto);
  }

  async updateAppearancePreferences(
    userId: string,
    dto: UpdateAppearancePreferencesDto,
  ) {
    const appearance = normalizeAppearancePreferences(dto);
    return this.usersRepo.updateAppearancePreferences(userId, appearance);
  }

  async getPublicProfile(id: string): Promise<Partial<Profile>> {
    const profile = await this.usersRepo.findPublicById(id);
    if (!profile) throw new NotFoundException('User not found');
    return profile;
  }
}
