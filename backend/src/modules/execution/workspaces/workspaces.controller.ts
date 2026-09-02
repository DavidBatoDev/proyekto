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
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { WorkspacesService } from './workspaces.service';
import {
  CreateWorkspaceDto,
  InviteWorkspaceMemberDto,
  RespondWorkspaceInviteDto,
  UpdateWorkspaceDto,
  UpdateWorkspaceMemberDto,
} from './dto/workspaces.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.workspaces.listMyWorkspaces(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWorkspaceDto,
  ) {
    return this.workspaces.createWorkspace(user.id, dto);
  }

  // Self-scoped invite routes. MUST be declared before the `:id` routes so
  // Nest's route matcher doesn't treat "me" as a workspace id.

  @Get('me/invites')
  listMyInvites(@CurrentUser() user: AuthenticatedUser) {
    return this.workspaces.listInvitesForMe(user.id);
  }

  @Post('me/invites/:inviteId/respond')
  respondInvite(
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RespondWorkspaceInviteDto,
  ) {
    return this.workspaces.respondInvite(inviteId, user.id, dto);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workspaces.getWorkspace(id, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspaces.updateWorkspace(id, user.id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workspaces.deleteWorkspace(id, user.id);
  }

  @Get(':id/members')
  listMembers(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workspaces.listMembers(id, user.id);
  }

  @Patch(':id/members/:userId')
  updateMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateWorkspaceMemberDto,
  ) {
    return this.workspaces.updateMember(id, userId, user.id, dto);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.removeMember(id, userId, user.id);
  }

  // ─── invites ───────────────────────────────────────────────────────────

  @Post(':id/invites')
  invite(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteWorkspaceMemberDto,
  ) {
    return this.workspaces.inviteByEmail(id, user.id, dto);
  }

  @Get(':id/invites')
  listInvites(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workspaces.listInvitesForWorkspace(id, user.id);
  }

  @Delete(':id/invites/:inviteId')
  cancelInvite(
    @Param('id') id: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspaces.cancelInvite(id, inviteId, user.id);
  }
}
