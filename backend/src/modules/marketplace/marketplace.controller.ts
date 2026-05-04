import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { ConsultantOnlyGuard } from '../../common/guards/consultant-only.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import {
  InviteFreelancerDto,
  MarketplaceQueryDto,
  RespondInviteDto,
} from './dto/marketplace.dto';

@Controller('marketplace')
@UseGuards(SupabaseAuthGuard)
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  /**
   * Browse the freelancer pool. Gated by the ConsultantOnlyGuard so only
   * verified consultants see freelancers — clients never browse them
   * directly. The MarketplaceService.getFreelancers also calls
   * ensureConsultant() internally as belt-and-suspenders.
   */
  @Get('freelancers')
  @UseGuards(ConsultantOnlyGuard)
  getFreelancers(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MarketplaceQueryDto,
  ) {
    return this.marketplaceService.getFreelancers(user.id, query);
  }

  @Post('go-live')
  goLive(@CurrentUser() user: AuthenticatedUser) {
    return this.marketplaceService.goLive(user.id);
  }

  @Post('invite')
  @UseGuards(ConsultantOnlyGuard)
  inviteFreelancer(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteFreelancerDto,
  ) {
    return this.marketplaceService.inviteFreelancer(user.id, dto);
  }

  @Get('invites/me')
  getMyInvites(@CurrentUser() user: AuthenticatedUser) {
    return this.marketplaceService.getMyInvites(user.id);
  }

  @Patch('invites/:inviteId/respond')
  respondInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('inviteId') inviteId: string,
    @Body() dto: RespondInviteDto,
  ) {
    return this.marketplaceService.respondInvite(user.id, inviteId, dto);
  }
}
