import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ChatService } from '../chat/chat.service';

/**
 * The project provisioned for every user as their own space. Formerly called a
 * "personal workspace" — renamed when Workspace became the organization tier,
 * because the two were entirely different things wearing the same word.
 */
export interface PersonalProject {
  id: string;
  title: string;
  owner_id: string;
  status: string | null;
}

interface SupabaseResult {
  data: unknown;
  error: { message: string } | null;
}

function isPersonalProject(value: unknown): value is PersonalProject {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.title === 'string' &&
    typeof row.owner_id === 'string' &&
    (typeof row.status === 'string' || row.status === null)
  );
}

function firstEmbeddedRow(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const rows = value as unknown[];
  return rows[0];
}

@Injectable()
export class PersonalProjectService {
  private readonly logger = new Logger(PersonalProjectService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly chatService: ChatService,
  ) {}

  /**
   * Idempotently provision the user's single personal project.
   *
   * The database RPC owns the transaction, advisory lock, project insert,
   * normalized personal_projects mapping, owner access grant, and stamping the
   * project into the user's default workspace.
   */
  async provision(userId: string): Promise<PersonalProject> {
    const { data, error } = (await this.supabase.rpc(
      'provision_personal_project',
      { p_user_id: userId },
    )) as unknown as SupabaseResult;
    const created = firstEmbeddedRow(data);

    if (error || !isPersonalProject(created)) {
      this.logger.error(
        `Failed to provision personal project for ${userId}: ${error?.message ?? 'RPC returned no row'}`,
      );
      throw new Error(error?.message ?? 'Personal project RPC returned no row');
    }

    // Solo project → a single #general channel (best-effort; listRooms
    // backfills if this fails).
    try {
      await this.chatService.provisionDefaultChannels(
        created.id,
        userId,
        'personal',
      );
    } catch (err) {
      this.logger.warn(
        `provisionDefaultChannels failed for personal project ${created.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return created;
  }

  /**
   * Look up the existing personal project for a user, or null if none.
   * Public so AuthService / route handlers can read without forcing a write.
   */
  async findForUser(userId: string): Promise<PersonalProject | null> {
    return this.findExisting(userId);
  }

  private async findExisting(userId: string): Promise<PersonalProject | null> {
    const { data, error } = (await this.supabase
      .from('personal_projects')
      .select('project:projects(id, title, owner_id, status)')
      .eq('user_id', userId)
      .maybeSingle()) as unknown as SupabaseResult;

    if (error) {
      this.logger.error(
        `Failed to look up personal project for ${userId}: ${error.message}`,
      );
      throw new Error(error.message);
    }
    const embeddedProject =
      data && typeof data === 'object'
        ? (data as Record<string, unknown>).project
        : null;
    const project = firstEmbeddedRow(embeddedProject);
    return isPersonalProject(project) ? project : null;
  }
}
