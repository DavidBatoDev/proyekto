import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { TeamResourceFolder, TeamResourceLink } from '../../../common/entities';
import {
  normalizeReorderItems,
  reorderTempBase,
} from '../../../common/resources/reorder';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  CreateTeamResourceFolderDto,
  CreateTeamResourceLinkDto,
  ReorderTeamResourceFoldersDto,
  ReorderTeamResourceLinksDto,
  UpdateTeamResourceFolderDto,
  UpdateTeamResourceLinkDto,
} from './dto/team-resources.dto';
import { TeamsService } from './teams.service';

export type TeamResourceFolderWithLinks = TeamResourceFolder & {
  links: TeamResourceLink[];
};

export interface TeamResourcesPayload {
  folders: TeamResourceFolderWithLinks[];
  uncategorized_links: TeamResourceLink[];
}

/**
 * Team resources: one level of folders holding hyperlinks, plus links that sit
 * outside any folder. Links only — there is no file upload here, and none on
 * the project side either.
 *
 * The data access is ported from the project resources repository, because the
 * two run the same positioning scheme against the same index shapes and a
 * divergence would be silent. Two things differ deliberately:
 *
 *  - Writes are owner-or-admin. Project resources let any project member write;
 *    a team's resources are the team's shared reference material, and the
 *    Overview tab that shows them is an owner/admin surface.
 *  - There is no repository layer. The teams module talks to Supabase directly
 *    from its services, and introducing an interface for this one feature would
 *    leave an incoherent seam next to ~40 queries that do not use it.
 */
@Injectable()
export class TeamResourcesService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly teams: TeamsService,
  ) {}

  // ── Authorization ────────────────────────────────────────────────────────

  /** Any member may read the team's resources. */
  private async assertCanRead(teamId: string, userId: string): Promise<void> {
    const team = await this.teams.fetchTeamOrThrow(teamId);
    await this.teams.assertCanRead(team, userId);
  }

  /** Only the owner and team admins may change them. */
  private async assertCanWrite(teamId: string, userId: string): Promise<void> {
    const team = await this.teams.fetchTeamOrThrow(teamId);
    await this.teams.assertCanManageTeam(team, userId, 'manage team resources');
  }

  // ── Text helpers ─────────────────────────────────────────────────────────

  private normalizeRequiredText(
    value: string | undefined,
    field: string,
  ): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      throw new BadRequestException(`${field} is required.`);
    }
    return normalized;
  }

  private normalizeOptionalText(value?: string): string | null {
    if (value === undefined) return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  // ── Position helpers ─────────────────────────────────────────────────────

  private async assertFolderBelongsToTeam(
    teamId: string,
    folderId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('team_resource_folders')
      .select('id')
      .eq('id', folderId)
      .eq('team_id', teamId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        error.message || 'Failed to validate resource folder.',
      );
    }
    if (!data) {
      throw new NotFoundException('Resource folder not found.');
    }
  }

  private async getNextFolderPosition(teamId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('team_resource_folders')
      .select('position')
      .eq('team_id', teamId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        error.message || 'Failed to compute next folder position.',
      );
    }
    return typeof data?.position === 'number' ? data.position + 1 : 0;
  }

  private async getNextLinkPosition(
    teamId: string,
    folderId: string | null,
  ): Promise<number> {
    let query = this.supabase
      .from('team_resource_links')
      .select('position')
      .eq('team_id', teamId)
      .order('position', { ascending: false })
      .limit(1);

    query =
      folderId === null
        ? query.is('folder_id', null)
        : query.eq('folder_id', folderId);

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new BadRequestException(
        error.message || 'Failed to compute next link position.',
      );
    }
    return typeof data?.position === 'number' ? data.position + 1 : 0;
  }

  /**
   * Re-pack a container's positions to 0..n-1 after a delete or a move out.
   * Two passes, because the partial UNIQUE indexes mean a row cannot be written
   * straight onto a position another row still holds, and supabase-js cannot
   * wrap the pair in a transaction.
   */
  private async compactLinksContainer(
    teamId: string,
    folderId: string | null,
  ): Promise<void> {
    let query = this.supabase
      .from('team_resource_links')
      .select('id, position')
      .eq('team_id', teamId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    query =
      folderId === null
        ? query.is('folder_id', null)
        : query.eq('folder_id', folderId);

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);

    const links =
      (data as Array<{ id: string; position: number }> | null) ?? [];
    if (links.length === 0) return;

    const tempBase = reorderTempBase(
      links.map((link) => link.position),
      links.length,
    );

    for (const [index, link] of links.entries()) {
      const { error: tempError } = await this.supabase
        .from('team_resource_links')
        .update({
          position: tempBase + index,
          updated_at: new Date().toISOString(),
        })
        .eq('id', link.id)
        .eq('team_id', teamId);
      if (tempError) throw new BadRequestException(tempError.message);
    }

    for (const [index, link] of links.entries()) {
      const { error: finalError } = await this.supabase
        .from('team_resource_links')
        .update({
          position: index,
          updated_at: new Date().toISOString(),
        })
        .eq('id', link.id)
        .eq('team_id', teamId);
      if (finalError) throw new BadRequestException(finalError.message);
    }
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  async listResources(
    teamId: string,
    userId: string,
  ): Promise<TeamResourcesPayload> {
    await this.assertCanRead(teamId, userId);

    const [foldersResult, linksResult] = await Promise.all([
      this.supabase
        .from('team_resource_folders')
        .select('*')
        .eq('team_id', teamId)
        .order('position', { ascending: true }),
      this.supabase
        .from('team_resource_links')
        .select('*')
        .eq('team_id', teamId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
    ]);

    if (foldersResult.error) {
      throw new BadRequestException(foldersResult.error.message);
    }
    if (linksResult.error) {
      throw new BadRequestException(linksResult.error.message);
    }

    const folders =
      (foldersResult.data as TeamResourceFolder[] | null)?.map((folder) => ({
        ...folder,
        links: [] as TeamResourceLink[],
      })) ?? [];
    const folderMap = new Map<string, TeamResourceFolderWithLinks>(
      folders.map((folder) => [folder.id, folder]),
    );

    // A link whose folder did not resolve falls back to uncategorized rather
    // than vanishing — the UI should show an orphan, not hide it.
    const uncategorizedLinks: TeamResourceLink[] = [];
    const links = (linksResult.data as TeamResourceLink[] | null) ?? [];
    for (const link of links) {
      const folder = link.folder_id ? folderMap.get(link.folder_id) : undefined;
      if (folder) {
        folder.links.push(link);
      } else {
        uncategorizedLinks.push(link);
      }
    }

    return { folders, uncategorized_links: uncategorizedLinks };
  }

  // ── Folders ──────────────────────────────────────────────────────────────

  async createFolder(
    teamId: string,
    userId: string,
    dto: CreateTeamResourceFolderDto,
  ): Promise<TeamResourceFolder> {
    await this.assertCanWrite(teamId, userId);

    const name = this.normalizeRequiredText(dto.name, 'Folder name');
    const position = await this.getNextFolderPosition(teamId);

    const { data, error } = await this.supabase
      .from('team_resource_folders')
      .insert({
        team_id: teamId,
        name,
        position,
        // Spread conditionally so the column defaults apply when omitted,
        // rather than writing an explicit undefined.
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new BadRequestException(
        error?.message || 'Failed to create resource folder.',
      );
    }
    return data as TeamResourceFolder;
  }

  async updateFolder(
    teamId: string,
    userId: string,
    folderId: string,
    dto: UpdateTeamResourceFolderDto,
  ): Promise<TeamResourceFolder> {
    await this.assertCanWrite(teamId, userId);

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      patch.name = this.normalizeRequiredText(dto.name, 'Folder name');
    }
    if (dto.icon !== undefined) patch.icon = dto.icon;
    if (dto.color !== undefined) patch.color = dto.color;

    // An empty patch is a read, not a no-op write: it still has to 404 for a
    // folder that does not exist.
    if (Object.keys(patch).length === 0) {
      const { data, error } = await this.supabase
        .from('team_resource_folders')
        .select('*')
        .eq('team_id', teamId)
        .eq('id', folderId)
        .maybeSingle();
      if (error) throw new BadRequestException(error.message);
      if (!data) throw new NotFoundException('Resource folder not found.');
      return data as TeamResourceFolder;
    }

    const { data, error } = await this.supabase
      .from('team_resource_folders')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('team_id', teamId)
      .eq('id', folderId)
      .select('*')
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Resource folder not found.');
    return data as TeamResourceFolder;
  }

  /**
   * Deleting a folder does not delete its links: a BEFORE DELETE trigger moves
   * them to uncategorized with fresh positions. See
   * 20260901160000_team_resources_and_status.sql.
   */
  async deleteFolder(
    teamId: string,
    userId: string,
    folderId: string,
  ): Promise<void> {
    await this.assertCanWrite(teamId, userId);

    const { data: existing, error: findError } = await this.supabase
      .from('team_resource_folders')
      .select('id')
      .eq('team_id', teamId)
      .eq('id', folderId)
      .maybeSingle();
    if (findError) throw new BadRequestException(findError.message);
    if (!existing) throw new NotFoundException('Resource folder not found.');

    const { error } = await this.supabase
      .from('team_resource_folders')
      .delete()
      .eq('team_id', teamId)
      .eq('id', folderId);
    if (error) throw new BadRequestException(error.message);
  }

  async reorderFolders(
    teamId: string,
    userId: string,
    dto: ReorderTeamResourceFoldersDto,
  ): Promise<TeamResourceFolder[]> {
    await this.assertCanWrite(teamId, userId);

    const { data, error } = await this.supabase
      .from('team_resource_folders')
      .select('id, position')
      .eq('team_id', teamId)
      .order('position', { ascending: true });
    if (error) throw new BadRequestException(error.message);

    const existing =
      (data as Array<{ id: string; position: number }> | null) ?? [];
    if (existing.length === 0) {
      throw new BadRequestException('No resource folders found to reorder.');
    }

    const sortedItems = normalizeReorderItems(
      dto.items,
      existing.map((item) => item.id),
      'Folder',
    );
    const tempBase = reorderTempBase(
      existing.map((item) => item.position),
      sortedItems.length,
    );

    for (const [index, item] of sortedItems.entries()) {
      const { error: tempError } = await this.supabase
        .from('team_resource_folders')
        .update({
          position: tempBase + index,
          updated_at: new Date().toISOString(),
        })
        .eq('team_id', teamId)
        .eq('id', item.id);
      if (tempError) throw new BadRequestException(tempError.message);
    }

    for (const item of sortedItems) {
      const { error: finalError } = await this.supabase
        .from('team_resource_folders')
        .update({
          position: item.position,
          updated_at: new Date().toISOString(),
        })
        .eq('team_id', teamId)
        .eq('id', item.id);
      if (finalError) throw new BadRequestException(finalError.message);
    }

    const { data: refreshed, error: refreshError } = await this.supabase
      .from('team_resource_folders')
      .select('*')
      .eq('team_id', teamId)
      .order('position', { ascending: true });
    if (refreshError) throw new BadRequestException(refreshError.message);
    return (refreshed as TeamResourceFolder[] | null) ?? [];
  }

  // ── Links ────────────────────────────────────────────────────────────────

  async createLink(
    teamId: string,
    userId: string,
    dto: CreateTeamResourceLinkDto,
  ): Promise<TeamResourceLink> {
    await this.assertCanWrite(teamId, userId);

    const title = this.normalizeRequiredText(dto.title, 'Link title');
    const url = this.normalizeRequiredText(dto.url, 'Link URL');
    const description = this.normalizeOptionalText(dto.description);
    const folderId = dto.folder_id ?? null;

    if (folderId) {
      await this.assertFolderBelongsToTeam(teamId, folderId);
    }

    const position = await this.getNextLinkPosition(teamId, folderId);

    const { data, error } = await this.supabase
      .from('team_resource_links')
      .insert({
        team_id: teamId,
        folder_id: folderId,
        title,
        url,
        description,
        position,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new BadRequestException(
        error?.message || 'Failed to create resource link.',
      );
    }
    return data as TeamResourceLink;
  }

  async updateLink(
    teamId: string,
    userId: string,
    linkId: string,
    dto: UpdateTeamResourceLinkDto,
  ): Promise<TeamResourceLink> {
    await this.assertCanWrite(teamId, userId);

    const { data: existing, error: existingError } = await this.supabase
      .from('team_resource_links')
      .select('*')
      .eq('team_id', teamId)
      .eq('id', linkId)
      .maybeSingle();
    if (existingError) throw new BadRequestException(existingError.message);
    if (!existing) throw new NotFoundException('Resource link not found.');

    const existingLink = existing as TeamResourceLink;
    const patch: Record<string, unknown> = {};
    let shouldCompactSourceContainer = false;

    if (dto.title !== undefined) {
      patch.title = this.normalizeRequiredText(dto.title, 'Link title');
    }
    if (dto.url !== undefined) {
      patch.url = this.normalizeRequiredText(dto.url, 'Link URL');
    }
    if (dto.description !== undefined) {
      patch.description = this.normalizeOptionalText(dto.description);
    }

    // An absent folder_id means "leave the link where it is"; a present null
    // means "move it to uncategorized". Only hasOwnProperty tells those apart.
    const hasFolderIdInPayload = Object.prototype.hasOwnProperty.call(
      dto,
      'folder_id',
    );
    let sourceFolderIdForCompaction: string | null =
      existingLink.folder_id ?? null;

    if (hasFolderIdInPayload) {
      const nextFolderId = dto.folder_id ?? null;
      if (nextFolderId !== null) {
        await this.assertFolderBelongsToTeam(teamId, nextFolderId);
      }

      patch.folder_id = nextFolderId;
      if (nextFolderId !== (existingLink.folder_id ?? null)) {
        // Moving containers: append at the destination, then close the gap the
        // link left behind in its old one.
        shouldCompactSourceContainer = true;
        patch.position = await this.getNextLinkPosition(teamId, nextFolderId);
      } else {
        sourceFolderIdForCompaction = null;
      }
    }

    if (Object.keys(patch).length === 0) {
      return existingLink;
    }

    const { data, error } = await this.supabase
      .from('team_resource_links')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('team_id', teamId)
      .eq('id', linkId)
      .select('*')
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Resource link not found.');

    if (shouldCompactSourceContainer) {
      await this.compactLinksContainer(teamId, sourceFolderIdForCompaction);
    }
    return data as TeamResourceLink;
  }

  async deleteLink(
    teamId: string,
    userId: string,
    linkId: string,
  ): Promise<void> {
    await this.assertCanWrite(teamId, userId);

    const { data: existing, error: findError } = await this.supabase
      .from('team_resource_links')
      .select('id, folder_id')
      .eq('team_id', teamId)
      .eq('id', linkId)
      .maybeSingle();
    if (findError) throw new BadRequestException(findError.message);
    if (!existing) throw new NotFoundException('Resource link not found.');

    const sourceFolderId =
      (existing as { folder_id: string | null }).folder_id ?? null;

    const { error } = await this.supabase
      .from('team_resource_links')
      .delete()
      .eq('team_id', teamId)
      .eq('id', linkId);
    if (error) throw new BadRequestException(error.message);

    await this.compactLinksContainer(teamId, sourceFolderId);
  }

  async reorderLinks(
    teamId: string,
    userId: string,
    dto: ReorderTeamResourceLinksDto,
  ): Promise<TeamResourceLink[]> {
    await this.assertCanWrite(teamId, userId);

    const folderId = dto.folder_id ?? null;
    if (folderId) {
      await this.assertFolderBelongsToTeam(teamId, folderId);
    }

    let query = this.supabase
      .from('team_resource_links')
      .select('id, position')
      .eq('team_id', teamId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    query =
      folderId === null
        ? query.is('folder_id', null)
        : query.eq('folder_id', folderId);

    const { data, error } = await query;
    if (error) throw new BadRequestException(error.message);

    const existing =
      (data as Array<{ id: string; position: number }> | null) ?? [];
    if (existing.length === 0) {
      throw new BadRequestException('No resource links found to reorder.');
    }

    const sortedItems = normalizeReorderItems(
      dto.items,
      existing.map((item) => item.id),
      'Link',
    );
    const tempBase = reorderTempBase(
      existing.map((item) => item.position),
      sortedItems.length,
    );

    for (const [index, item] of sortedItems.entries()) {
      const { error: tempError } = await this.supabase
        .from('team_resource_links')
        .update({
          position: tempBase + index,
          updated_at: new Date().toISOString(),
        })
        .eq('team_id', teamId)
        .eq('id', item.id);
      if (tempError) throw new BadRequestException(tempError.message);
    }

    for (const item of sortedItems) {
      const { error: finalError } = await this.supabase
        .from('team_resource_links')
        .update({
          position: item.position,
          updated_at: new Date().toISOString(),
        })
        .eq('team_id', teamId)
        .eq('id', item.id);
      if (finalError) throw new BadRequestException(finalError.message);
    }

    let refreshQuery = this.supabase
      .from('team_resource_links')
      .select('*')
      .eq('team_id', teamId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });

    refreshQuery =
      folderId === null
        ? refreshQuery.is('folder_id', null)
        : refreshQuery.eq('folder_id', folderId);

    const { data: refreshed, error: refreshError } = await refreshQuery;
    if (refreshError) throw new BadRequestException(refreshError.message);
    return (refreshed as TeamResourceLink[] | null) ?? [];
  }
}
