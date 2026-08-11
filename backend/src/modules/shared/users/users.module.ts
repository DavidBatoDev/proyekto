import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { SupabaseUsersRepository } from './repositories/users.repository.supabase';
import { USERS_REPOSITORY } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    { provide: USERS_REPOSITORY, useClass: SupabaseUsersRepository },
  ],
  exports: [UsersService],
})
export class UsersModule {}
