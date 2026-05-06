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
import { ProjectTeamsService } from './project-teams.service';
import {
  AddCuratedMemberDto,
  AttachTeamDto,
  UpdateCuratedMemberDto,
  UpdateProjectTeamDto,
} from './dto/teams.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('projects/:projectId/teams')
export class ProjectTeamsController {
  constructor(private readonly projectTeams: ProjectTeamsService) {}

  @Get()
  list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectTeams.list(projectId, user.id);
  }

  @Post()
  attach(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AttachTeamDto,
  ) {
    return this.projectTeams.attach(projectId, user.id, dto);
  }

  @Patch(':teamId')
  update(
    @Param('projectId') projectId: string,
    @Param('teamId') teamId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProjectTeamDto,
  ) {
    return this.projectTeams.updateAttachment(projectId, teamId, user.id, dto);
  }

  @Delete(':teamId')
  detach(
    @Param('projectId') projectId: string,
    @Param('teamId') teamId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectTeams.detach(projectId, teamId, user.id);
  }

  @Get(':teamId/members')
  listMembers(
    @Param('projectId') projectId: string,
    @Param('teamId') teamId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectTeams.listCuratedMembers(projectId, teamId, user.id);
  }

  @Get(':teamId/available-members')
  listAvailable(
    @Param('projectId') projectId: string,
    @Param('teamId') teamId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectTeams.listAvailableMembers(projectId, teamId, user.id);
  }

  @Post(':teamId/members')
  addMember(
    @Param('projectId') projectId: string,
    @Param('teamId') teamId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddCuratedMemberDto,
  ) {
    return this.projectTeams.addCuratedMember(projectId, teamId, user.id, dto);
  }

  @Patch(':teamId/members/:userId')
  updateMember(
    @Param('projectId') projectId: string,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateCuratedMemberDto,
  ) {
    return this.projectTeams.updateCuratedMember(
      projectId,
      teamId,
      userId,
      user.id,
      dto,
    );
  }

  @Delete(':teamId/members/:userId')
  removeMember(
    @Param('projectId') projectId: string,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectTeams.removeCuratedMember(
      projectId,
      teamId,
      userId,
      user.id,
    );
  }
}
