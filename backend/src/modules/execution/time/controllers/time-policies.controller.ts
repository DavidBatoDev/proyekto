import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsTimeZone } from 'class-validator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import { TeamTimePolicyDto, WorkspaceTimePolicyDto } from '../dto/policies.dto';
import { TimeGuestGuard } from '../guards/time-guest.guard';
import { TimePolicyService } from '../time-policy.service';
import type { TeamPolicyView, WorkspacePolicyView } from '../time.types';

/** `?tz=` on the workspace policy GET: a manager's browser timezone, used only to materialise a missing row. */
export class WorkspacePolicyQueryDto {
  @IsOptional() @IsTimeZone() tz?: string;
}

/** A malformed id is a miss (404), never a 400 that confirms the route shape. */
const ID_PIPE = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

/**
 * Workspace policy and team override (backend.md "Writes", §2.11). Misses are 404: a caller who does not manage
 * the workspace or team learns nothing about it. Guests 404 on every route (D08).
 */
@UseGuards(SupabaseAuthGuard, TimeGuestGuard)
@Controller('time/policies')
export class TimePoliciesController {
  constructor(private readonly policy: TimePolicyService) {}

  @Get('workspaces/:workspaceId')
  getWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ID_PIPE) workspaceId: string,
    @Query() query: WorkspacePolicyQueryDto,
  ): Promise<WorkspacePolicyView> {
    return this.policy.getWorkspacePolicy(user.id, workspaceId, query.tz);
  }

  @Put('workspaces/:workspaceId')
  putWorkspace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ID_PIPE) workspaceId: string,
    @Body() dto: WorkspaceTimePolicyDto,
  ): Promise<WorkspacePolicyView> {
    return this.policy.putWorkspacePolicy(user.id, workspaceId, dto);
  }

  @Get('teams/:teamId')
  getTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', ID_PIPE) teamId: string,
  ): Promise<TeamPolicyView> {
    return this.policy.getTeamPolicy(user.id, teamId);
  }

  @Put('teams/:teamId')
  putTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', ID_PIPE) teamId: string,
    @Body() dto: TeamTimePolicyDto,
  ): Promise<TeamPolicyView> {
    return this.policy.putTeamPolicy(user.id, teamId, dto);
  }

  /** Removes the override; answers the team's policy as it now resolves (inherited from the workspace). */
  @Delete('teams/:teamId')
  @HttpCode(HttpStatus.OK)
  async deleteTeam(
    @CurrentUser() user: AuthenticatedUser,
    @Param('teamId', ID_PIPE) teamId: string,
  ): Promise<TeamPolicyView> {
    await this.policy.deleteTeamPolicy(user.id, teamId);
    return this.policy.getTeamPolicy(user.id, teamId);
  }
}
