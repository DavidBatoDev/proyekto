import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ProjectsService } from './projects.service';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import {
  AppCacheStatus,
  RedisDataCacheService,
} from '../../common/cache/redis-data-cache.service';
import {
  AddProjectMemberDto,
  AssignConsultantDto,
  CreateProjectDto,
  CreateProjectFromRoadmapDto,
  CreateProjectResourceFolderDto,
  CreateProjectResourceLinkDto,
  InviteProjectByEmailDto,
  ProjectDashboardSummaryQueryDto,
  ProjectInviteQueryDto,
  ReassignProjectConsultantDto,
  ReorderProjectResourceFoldersDto,
  ReorderProjectResourceLinksDto,
  RespondProjectInviteDto,
  TransferProjectOwnerDto,
  UpdateProjectDto,
  UpdateMemberPositionDto,
  UpdateProjectMemberDto,
  UpdateProjectMemberPermissionsDto,
  UpdateProjectResourceFolderDto,
  UpdateProjectResourceLinkDto,
  UpdateRolePermissionsDto,
} from './dto/project.dto';

@Controller('projects')
@UseGuards(SupabaseAuthGuard)
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly dataCache: RedisDataCacheService,
  ) {}

  private setCacheHeader(response: Response, status: AppCacheStatus): void {
    if (!this.dataCache.isDebugHeadersEnabled()) return;
    response.setHeader('X-App-Cache', status);
  }

  @Get()
  listProjects(@CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.listUserProjects(user.id);
  }

  @Get('dashboard')
  listDashboardProjects(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.projectsService.listDashboardProjects(user.id, {
      onCacheStatus: (status) => this.setCacheHeader(response, status),
    });
  }

  @Get('dashboard/summary')
  getDashboardSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ProjectDashboardSummaryQueryDto,
  ) {
    return this.projectsService.getDashboardSummary(user.id, query);
  }

  // Static route — must be declared before @Get(':id') so "roadmap-link-
  // candidates" is not swallowed as a project id.
  @Get('roadmap-link-candidates')
  listRoadmapLinkCandidates(@CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.listRoadmapLinkCandidates(user.id);
  }

  @Post()
  createProject(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.createProject(user.id, dto);
  }

  @Post('from-roadmap')
  createProjectFromRoadmap(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectFromRoadmapDto,
  ) {
    if (user.is_guest) {
      throw new ForbiddenException('Sign in to create a project.');
    }
    return this.projectsService.createProjectFromRoadmap(user.id, dto);
  }

  @Get(':id')
  getProject(@Param('id') id: string) {
    return this.projectsService.getProject(id);
  }

  @Patch(':id')
  updateProject(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.updateProject(id, user.id, dto);
  }

  @Delete(':id')
  deleteProject(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.deleteProject(id, user.id);
  }

  @Post(':id/transfer-owner')
  transferOwner(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TransferProjectOwnerDto,
  ) {
    return this.projectsService.transferProjectOwner(id, user.id, dto);
  }

  @Post(':id/reassign-consultant')
  reassignConsultant(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReassignProjectConsultantDto,
  ) {
    return this.projectsService.reassignProjectConsultant(id, user.id, dto);
  }

  @Post(':id/assign-consultant')
  @UseGuards(AdminGuard)
  assignConsultant(@Param('id') id: string, @Body() dto: AssignConsultantDto) {
    return this.projectsService.assignConsultant(id, dto.consultant_id);
  }

  @Get(':id/resources')
  listResources(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.listProjectResources(id, user.id);
  }

  @Post(':id/resources/folders')
  createResourceFolder(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectResourceFolderDto,
  ) {
    return this.projectsService.createProjectResourceFolder(id, user.id, dto);
  }

  @Patch(':id/resources/folders/reorder')
  reorderResourceFolders(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReorderProjectResourceFoldersDto,
  ) {
    return this.projectsService.reorderProjectResourceFolders(id, user.id, dto);
  }

  @Patch(':id/resources/folders/:folderId')
  updateResourceFolder(
    @Param('id') id: string,
    @Param('folderId') folderId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProjectResourceFolderDto,
  ) {
    return this.projectsService.updateProjectResourceFolder(
      id,
      folderId,
      user.id,
      dto,
    );
  }

  @Delete(':id/resources/folders/:folderId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteResourceFolder(
    @Param('id') id: string,
    @Param('folderId') folderId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.deleteProjectResourceFolder(
      id,
      folderId,
      user.id,
    );
  }

  @Post(':id/resources/links')
  createResourceLink(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectResourceLinkDto,
  ) {
    return this.projectsService.createProjectResourceLink(id, user.id, dto);
  }

  @Patch(':id/resources/links/reorder')
  reorderResourceLinks(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReorderProjectResourceLinksDto,
  ) {
    return this.projectsService.reorderProjectResourceLinks(id, user.id, dto);
  }

  @Patch(':id/resources/links/:linkId')
  updateResourceLink(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProjectResourceLinkDto,
  ) {
    return this.projectsService.updateProjectResourceLink(
      id,
      linkId,
      user.id,
      dto,
    );
  }

  @Delete(':id/resources/links/:linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteResourceLink(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.deleteProjectResourceLink(id, linkId, user.id);
  }

  @Post(':id/members')
  addMember(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddProjectMemberDto,
  ) {
    return this.projectsService.addMember(id, user.id, dto);
  }

  @Post(':id/invites')
  inviteByEmail(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteProjectByEmailDto,
  ) {
    return this.projectsService.inviteByEmail(id, user.id, dto);
  }

  @Get('me/invites')
  listMyInvites(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ProjectInviteQueryDto,
  ) {
    return this.projectsService.listInvitesForUser(user.id, query);
  }

  @Patch('invites/:inviteId/respond')
  respondInvite(
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RespondProjectInviteDto,
  ) {
    return this.projectsService.respondInvite(user.id, inviteId, dto);
  }

  @Get(':id/invites')
  listProjectInvites(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.listProjectInvites(user.id, id);
  }

  @Delete(':id/invites/:inviteId')
  cancelInvite(
    @Param('id') id: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.cancelInvite(user.id, id, inviteId);
  }

  @Get(':id/permissions/role')
  getRolePermissions(
    @Param('id') id: string,
    @Query('role') role: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.getRolePermissions(user.id, id, role);
  }

  @Patch(':id/permissions/role')
  updateRolePermissions(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateRolePermissionsDto,
  ) {
    return this.projectsService.updateRolePermissions(user.id, id, dto);
  }

  @Patch(':id/members/:memberId')
  updateMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProjectMemberDto,
  ) {
    return this.projectsService.updateMember(id, memberId, user.id, dto);
  }

  @Get(':id/members/:memberId/permissions')
  getMemberPermissions(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.getMemberPermissions(id, memberId, user.id);
  }

  @Get(':id/my-permissions')
  getMyPermissions(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.getMyPermissions(id, user.id);
  }

  @Patch(':id/members/:memberId/permissions')
  updateMemberPermissions(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProjectMemberPermissionsDto,
  ) {
    return this.projectsService.updateMemberPermissions(
      id,
      memberId,
      user.id,
      dto,
    );
  }

  @Patch(':id/members/:memberId/position')
  updateMemberPosition(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMemberPositionDto,
  ) {
    return this.projectsService.updateMemberPosition(
      id,
      memberId,
      user.id,
      dto.position,
    );
  }

  @Post(':id/members/leave')
  leaveProject(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.leaveProject(id, user.id);
  }

  @Delete(':id/members/:memberId')
  removeMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.removeMember(id, memberId, user.id);
  }
}
