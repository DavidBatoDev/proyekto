import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  CreateTeamResourceFolderDto,
  CreateTeamResourceLinkDto,
  ReorderTeamResourceFoldersDto,
  ReorderTeamResourceLinksDto,
  UpdateTeamResourceFolderDto,
  UpdateTeamResourceLinkDto,
} from './dto/team-resources.dto';
import { TeamResourcesService } from './team-resources.service';

/**
 * A sibling controller rather than nine more routes on TeamsController, which
 * already carries its own declaration-order contract (`me/*` and
 * `preferences/*` ahead of `:id`). Two unrelated ordering hazards in one file
 * is one more than a reviewer will think to check. TeamMemberRatesController
 * is the same pattern.
 *
 * Note for whoever adds routes to TeamsController next: it is registered first
 * in teams.module.ts, so a `@Get(':id/resources')` declared there would shadow
 * this whole controller silently.
 */
@UseGuards(SupabaseAuthGuard)
@Controller('teams/:teamId/resources')
export class TeamResourcesController {
  constructor(private readonly resources: TeamResourcesService) {}

  @Get()
  list(
    @Param('teamId') teamId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resources.listResources(teamId, user.id);
  }

  // ── Folders ──────────────────────────────────────────────────────────────

  @Post('folders')
  createFolder(
    @Param('teamId') teamId: string,
    @Body() dto: CreateTeamResourceFolderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resources.createFolder(teamId, user.id, dto);
  }

  /**
   * MUST stay above `folders/:folderId`. Nest matches in declaration order, so
   * the parameterised route would otherwise swallow this one and bind
   * folderId = 'reorder' — a confusing 404 rather than a reorder.
   */
  @Patch('folders/reorder')
  reorderFolders(
    @Param('teamId') teamId: string,
    @Body() dto: ReorderTeamResourceFoldersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resources.reorderFolders(teamId, user.id, dto);
  }

  @Patch('folders/:folderId')
  updateFolder(
    @Param('teamId') teamId: string,
    @Param('folderId') folderId: string,
    @Body() dto: UpdateTeamResourceFolderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resources.updateFolder(teamId, user.id, folderId, dto);
  }

  @Delete('folders/:folderId')
  @HttpCode(204)
  async deleteFolder(
    @Param('teamId') teamId: string,
    @Param('folderId') folderId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.resources.deleteFolder(teamId, user.id, folderId);
  }

  // ── Links ────────────────────────────────────────────────────────────────

  @Post('links')
  createLink(
    @Param('teamId') teamId: string,
    @Body() dto: CreateTeamResourceLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resources.createLink(teamId, user.id, dto);
  }

  /** MUST stay above `links/:linkId` — same reason as folders/reorder. */
  @Patch('links/reorder')
  reorderLinks(
    @Param('teamId') teamId: string,
    @Body() dto: ReorderTeamResourceLinksDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resources.reorderLinks(teamId, user.id, dto);
  }

  @Patch('links/:linkId')
  updateLink(
    @Param('teamId') teamId: string,
    @Param('linkId') linkId: string,
    @Body() dto: UpdateTeamResourceLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resources.updateLink(teamId, user.id, linkId, dto);
  }

  @Delete('links/:linkId')
  @HttpCode(204)
  async deleteLink(
    @Param('teamId') teamId: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.resources.deleteLink(teamId, user.id, linkId);
  }
}
