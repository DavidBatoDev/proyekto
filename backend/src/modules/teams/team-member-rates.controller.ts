import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { TeamMemberRatesService } from './team-member-rates.service';
import {
  CreateTeamMemberRateDto,
  UpdateTeamMemberRateDto,
} from './dto/teams.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('teams/:teamId/members/:userId/rates')
export class TeamMemberRatesController {
  constructor(private readonly rates: TeamMemberRatesService) {}

  @Get()
  list(
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('projectId') projectId?: string,
  ) {
    return this.rates.listForMember(teamId, userId, user.id, projectId);
  }

  @Get('active')
  active(
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('projectId') projectId?: string,
  ) {
    if (!projectId) {
      throw new BadRequestException('projectId query param is required');
    }
    return this.rates.getActive(teamId, userId, projectId, user.id);
  }

  @Post()
  create(
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTeamMemberRateDto,
  ) {
    return this.rates.create(teamId, userId, user.id, dto);
  }

  @Patch(':rateId')
  update(
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
    @Param('rateId') rateId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTeamMemberRateDto,
  ) {
    return this.rates.update(teamId, userId, rateId, user.id, dto);
  }

  @Delete(':rateId')
  remove(
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
    @Param('rateId') rateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rates.delete(teamId, userId, rateId, user.id);
  }
}
