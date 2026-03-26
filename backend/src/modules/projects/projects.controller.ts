import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import {
  AddProjectMemberDto,
  AssignConsultantDto,
  CreateProjectDto,
  CreateProjectResourceFolderDto,
  CreateProjectResourceLinkDto,
  InviteProjectByEmailDto,
  ProjectInviteQueryDto,
  ReassignProjectConsultantDto,
  ReorderProjectResourceFoldersDto,
  ReorderProjectResourceLinksDto,
  RespondProjectInviteDto,
  TransferProjectOwnerDto,
  UpdateProjectDto,
  UpdateProjectMemberDto,
  UpdateProjectMemberPermissionsDto,
  UpdateProjectResourceFolderDto,
  UpdateProjectResourceLinkDto,
} from './dto/project.dto';

@Controller('projects')
@UseGuards(SupabaseAuthGuard)
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  listProjects(@CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.listUserProjects(user.id);
  }

  @Get('dashboard')
  listDashboardProjects(@CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.listDashboardProjects(user.id);
  }

  @Post()
  createProject(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.createProject(user.id, dto);
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
