import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SetCachePolicy } from '../../common/decorators/cache-policy.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { CACHE_POLICY_PRESETS } from '../../common/cache/cache-policy';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
@UseGuards(SupabaseAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @SetCachePolicy(CACHE_POLICY_PRESETS.PRIVATE_BROWSER_SHORT)
  getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.usersService.getMe(user.id);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateUserDto) {
    return this.usersService.updateMe(user.id, dto);
  }

  @Get(':id')
  getPublicProfile(@Param('id') id: string) {
    return this.usersService.getPublicProfile(id);
  }
}
