import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { ProjectTeamInvitesService } from './project-team-invites.service';
import {
  InviteTeamToProjectDto,
  RespondProjectTeamInviteDto,
} from './dto/teams.dto';

/**
 * Project-side of "Invite a team": send, list and cancel invitations asking
 * someone to bring one of their teams onto this project.
 *
 * Deliberately not folded into ProjectTeamsController — that controller is
 * mounted at `projects/:projectId/teams`, where a `team-invites` segment would
 * collide with its `:teamId` param route.
 */
@UseGuards(SupabaseAuthGuard)
@Controller('projects/:projectId/team-invites')
export class ProjectTeamInvitesController {
  constructor(private readonly invites: ProjectTeamInvitesService) {}

  @Get()
  list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invites.listForProject(projectId, user.id);
  }

  @Post()
  invite(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteTeamToProjectDto,
  ) {
    return this.invites.invite(projectId, user.id, dto);
  }

  @Delete(':inviteId')
  cancel(
    @Param('projectId') projectId: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invites.cancel(projectId, inviteId, user.id);
  }
}

/**
 * Recipient-side. Separate controller because these routes are scoped to the
 * caller, not to a project the caller has no access to yet — an invitee has no
 * standing under `projects/:projectId/*` until they accept.
 */
@UseGuards(SupabaseAuthGuard)
@Controller('team-project-invites')
export class MyProjectTeamInvitesController {
  constructor(private readonly invites: ProjectTeamInvitesService) {}

  @Get('me')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.invites.listForMe(user.id);
  }

  @Post('me/:inviteId/respond')
  respond(
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RespondProjectTeamInviteDto,
  ) {
    return this.invites.respond(inviteId, user.id, dto);
  }
}
