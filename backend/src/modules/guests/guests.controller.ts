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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { SetCachePolicy } from '../../common/decorators/cache-policy.decorator';
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
    // Shape mirrors findBySession so the web client (createGuestProfile) reads
    // `data.user_id` from either endpoint. The RPC returns the bare guest UUID.
    return { user_id: data };
  }

  async findBySession(sessionId: string) {
    const { data, error } = await this.supabase.rpc('get_guest_user_id', {
      session_id: sessionId,
    });
    if (error || !data) throw new NotFoundException('Guest session not found');
    return { user_id: data };
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
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  createGuest(@Body() dto: CreateGuestDto) {
    return this.guestsService.createGuest(dto);
  }

  @Get('by-session/:sessionId')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  findBySession(@Param('sessionId') sessionId: string) {
    return this.guestsService.findBySession(sessionId);
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
