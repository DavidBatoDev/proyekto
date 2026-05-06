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
  AddTeamMemberDto,
  CreateTeamDto,
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

  @Post(':id/members')
  addMember(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddTeamMemberDto,
  ) {
    return this.teams.addMember(id, user.id, dto);
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
}
