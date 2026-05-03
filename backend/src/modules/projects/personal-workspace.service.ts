import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';

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

    await this.attachOwnerMember(created.id, userId);

    return created as PersonalWorkspace;
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
