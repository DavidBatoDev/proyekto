import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SetCachePolicy } from '../../common/decorators/cache-policy.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { CACHE_POLICY_PRESETS } from '../../common/cache/cache-policy';
import { CreateGuestDto } from './dto/guest.dto';

@Injectable()
export class GuestsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async createGuest(dto: CreateGuestDto) {
    const { data, error } = await this.supabase.rpc('create_guest_user', {
      session_id: dto.session_id,
    });
    if (error) throw new Error(error.message);
    return data;
  }

  async findBySession(sessionId: string) {
    const { data, error } = await this.supabase.rpc('get_guest_user_id', {
      session_id: sessionId,
    });
    if (error || !data) throw new NotFoundException('Guest session not found');
    return { user_id: data };
  }

  async migrateRoadmaps(guestId: string, authenticatedUserId: string) {
    const { data, error } = await this.supabase
      .from('roadmaps')
      .update({ owner_id: authenticatedUserId })
      .eq('owner_id', guestId)
      .select();
    if (error) throw new Error(error.message);

    // Update profiles to mark migration
    await this.supabase
      .from('profiles')
      .update({ migrated_from_guest_id: guestId })
      .eq('id', authenticatedUserId);

    return { migrated: (data || []).length };
  }

  async getPending(sessionId: string) {
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('guest_session_id', sessionId)
      .eq('is_guest', true)
      .single();

    if (!profile) return { hasPendingData: false };

    const { count } = await this.supabase
      .from('roadmaps')
      .select('id', { count: 'exact' })
      .eq('owner_id', (profile as Record<string, string>).id);

    return {
      hasPendingData: (count ?? 0) > 0,
      guestId: (profile as Record<string, string>).id,
    };
  }

  async cleanup() {
    const { data, error } = await this.supabase.rpc('cleanup_old_guest_users');
    if (error) throw new Error(error.message);
    return { cleaned: data };
  }
}

@Controller('guests')
@UseGuards(SupabaseAuthGuard)
@SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
export class GuestsController {
  constructor(private readonly guestsService: GuestsService) {}

  @Post('create')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  createGuest(@Body() dto: CreateGuestDto) {
    return this.guestsService.createGuest(dto);
  }

  @Get('by-session/:sessionId')
  @Public()
  findBySession(@Param('sessionId') sessionId: string) {
    return this.guestsService.findBySession(sessionId);
  }

  @Post('migrate')
  @HttpCode(HttpStatus.OK)
  migrateRoadmaps(
    @CurrentUser() user: AuthenticatedUser,
    @Body('guest_id') guestId: string,
  ) {
    return this.guestsService.migrateRoadmaps(guestId, user.id);
  }

  @Get('pending/:sessionId')
  @Public()
  getPending(@Param('sessionId') sessionId: string) {
    return this.guestsService.getPending(sessionId);
  }

  @Post('cleanup')
  @HttpCode(HttpStatus.OK)
  cleanup() {
    return this.guestsService.cleanup();
  }
}
