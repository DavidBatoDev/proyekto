import { Global, Module } from '@nestjs/common';
import { RevokedUsersService } from './revoked-users.service';

/**
 * Global because `SupabaseAuthGuard` and `McpAuthGuard` are applied with
 * `@UseGuards(...)` inside dozens of feature modules, and Nest resolves a
 * guard's dependencies from the module it is used in. Registering this once
 * keeps every one of those modules unchanged.
 */
@Global()
@Module({
  providers: [RevokedUsersService],
  exports: [RevokedUsersService],
})
export class RevokedUsersModule {}
