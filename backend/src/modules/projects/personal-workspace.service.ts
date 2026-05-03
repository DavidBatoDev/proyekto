import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import { ProjectAuthorizationService } from './authorization/project-authorization.service';

export interface PersonalWorkspace {
  id: string;
  title: string;
  client_id: string;
  is_personal_workspace: true;
  status: string | null;
}

@Injectable()
export class PersonalWorkspaceService {
  private readonly logger = new Logger(PersonalWorkspaceService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly authorization: ProjectAuthorizationService,
  ) {}

  /**
   * Idempotently provision the user's single personal workspace.
   *
   * Returns the existing workspace if one is already present (the partial
   * unique index on `projects(client_id) WHERE is_personal_workspace = true`
   * is the source of truth). Otherwise creates the project + owner
   * project_members row and returns the new workspace.
   *
   * On race (two concurrent calls), one INSERT will fail with the unique
   * index violation; we re-fetch and return the surviving row.
   */
  async provision(userId: string): Promise<PersonalWorkspace> {
    const existing = await this.findExisting(userId);
    if (existing) return existing;

    const title = await this.buildDefaultTitle(userId);

    const { data: created, error: insertError } = await this.supabase
      .from('projects')
      .insert({
        client_id: userId,
        consultant_id: null,
        is_personal_workspace: true,
        title,
        status: 'active',
      })
      .select('id, title, client_id, is_personal_workspace, status')
      .single();

    if (insertError) {
      // Race: another call won the partial unique index. Re-fetch.
      if (insertError.code === '23505') {
        const survivor = await this.findExisting(userId);
        if (survivor) return survivor;
      }
      this.logger.error(
        `Failed to create personal workspace for ${userId}: ${insertError.message}`,
      );
      throw new Error(insertError.message);
    }
    if (!created) {
      throw new Error('Personal workspace insert returned no row');
    }

    // Dual-write during slice 2 transition: project_shares is the new source
    // of truth; project_members is kept for backward compatibility with
    // unmodified RLS policies on dependent tables (work_items, milestones,
    // etc). Slice 3 drops the project_members write.
    await this.attachOwnerShare(created.id, userId);
    await this.attachOwnerMember(created.id, userId);

    return created as PersonalWorkspace;
  }

  private async attachOwnerShare(
    projectId: string,
    userId: string,
  ): Promise<void> {
    try {
      await this.authorization.grant({
        projectId,
        userId,
        role: 'owner',
        origin: 'personal_workspace',
        grantedBy: userId,
      });
    } catch (err) {
      this.logger.error(
        `Failed to grant owner share for personal workspace ${projectId} (user ${userId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }

  /**
   * Look up the existing personal workspace for a user, or null if none.
   * Public so AuthService / route handlers can read without forcing a write.
   */
  async findForUser(userId: string): Promise<PersonalWorkspace | null> {
    return this.findExisting(userId);
  }

  private async findExisting(
    userId: string,
  ): Promise<PersonalWorkspace | null> {
    const { data, error } = await this.supabase
      .from('projects')
      .select('id, title, client_id, is_personal_workspace, status')
      .eq('client_id', userId)
      .eq('is_personal_workspace', true)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Failed to look up personal workspace for ${userId}: ${error.message}`,
      );
      throw new Error(error.message);
    }
    return (data as PersonalWorkspace | null) ?? null;
  }

  private async buildDefaultTitle(userId: string): Promise<string> {
    const { data } = await this.supabase
      .from('profiles')
      .select('first_name, display_name')
      .eq('id', userId)
      .maybeSingle();

    const name =
      (data?.first_name as string | undefined)?.trim() ||
      (data?.display_name as string | undefined)?.trim() ||
      'My';
    return `${name}'s Workspace`;
  }

  private async attachOwnerMember(
    projectId: string,
    userId: string,
  ): Promise<void> {
    // Interim ownership marker until project_shares lands in a later slice.
    const { error } = await this.supabase.from('project_members').insert({
      project_id: projectId,
      user_id: userId,
      role: 'member',
      position: 'Owner',
      permissions_json: { is_owner: true },
    });

    if (error) {
      // Don't roll back the project — re-running provision() would reuse it
      // and a follow-up call to attachOwnerMember could re-attempt. But for
      // hygiene we surface the error so the caller can decide.
      this.logger.error(
        `Failed to attach owner member ${userId} to workspace ${projectId}: ${error.message}`,
      );
      throw new Error(error.message);
    }
  }
}
