import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { TeamsService } from './teams.service';
import {
  CreateTeamDto,
  InviteTeamMemberDto,
  RespondTeamInviteDto,
  UpdateTeamDto,
  UpdateTeamMemberDto,
} from './dto/teams.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.teams.listMyTeams(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTeamDto,
  ) {
    return this.teams.createTeam(user.id, dto);
  }

  // Self-scoped invite routes. MUST be declared before the `:id` routes
  // so Nest's route matcher doesn't treat "me" as a team id.

  @Get('me/invites')
  listMyInvites(@CurrentUser() user: AuthenticatedUser) {
    return this.teams.listInvitesForMe(user.id);
  }

  @Post('me/invites/:inviteId/respond')
  respondInvite(
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RespondTeamInviteDto,
  ) {
    return this.teams.respondInvite(inviteId, user.id, dto);
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teams.getTeam(id, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.teams.updateTeam(id, user.id, dto);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teams.deleteTeam(id, user.id);
  }

  @Get(':id/members')
  listMembers(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teams.listMembers(id, user.id);
  }

  @Get(':id/projects')
  listProjects(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teams.listProjectsForTeam(id, user.id);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTeamMemberDto,
  ) {
    return this.teams.updateMember(id, userId, user.id, dto);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teams.removeMember(id, userId, user.id);
  }

  // ─── invites ───────────────────────────────────────────────────────────

  @Post(':id/invites')
  invite(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteTeamMemberDto,
  ) {
    return this.teams.inviteByEmail(id, user.id, dto);
  }

  @Get(':id/invites')
  listInvites(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teams.listInvitesForTeam(id, user.id);
  }

  @Delete(':id/invites/:inviteId')
  cancelInvite(
    @Param('id') id: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.teams.cancelInvite(id, inviteId, user.id);
  }
}
