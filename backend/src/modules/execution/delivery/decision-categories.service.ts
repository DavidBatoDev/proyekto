import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import type { DecisionCategoryRow } from './delivery.types';
import type {
  CreateDecisionCategoryDto,
  UpdateDecisionCategoryDto,
} from './dto/delivery.dto';

const TABLE = 'project_decision_categories';
const DECISIONS_TABLE = 'project_decisions';

const SELECT =
  'id, project_id, name, color, icon, position, created_by, created_at, updated_at';

/**
 * The per-project decision taxonomy.
 *
 * Nothing is seeded. The six suggested categories are client-side presets
 * (CATEGORY_PRESETS in web); picking one calls `create` like any other name, so
 * nothing here has to know which categories are "special". That mirrors how the
 * default chat channels ended up after `chat_rooms.system_key` was tried and
 * dropped a day later.
 *
 * Names are unique per project case-insensitively, enforced by
 * `uq_decision_categories_name`. The 23505 is translated to a 409 here so the
 * form can say "you already have one called that" instead of showing a 500.
 */
@Injectable()
export class DecisionCategoriesService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
    private readonly authorization: ProjectAuthorizationService,
  ) {}

  async list(projectId: string, userId: string) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'access.delivery',
    );

    const { data, error } = await this.db
      .from(TABLE)
      .select(SELECT)
      .eq('project_id', projectId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .overrideTypes<DecisionCategoryRow[], { merge: false }>();

    if (error) {
      throw new InternalServerErrorException(
        `Failed to list decision categories: ${error.message}`,
      );
    }
    return data ?? [];
  }

  async create(
    projectId: string,
    userId: string,
    dto: CreateDecisionCategoryDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'decisions.edit',
    );

    const { data, error } = await this.db
      .from(TABLE)
      .insert({
        project_id: projectId,
        name: dto.name.trim(),
        color: dto.color ?? 'slate',
        icon: dto.icon ?? 'tag',
        position: await this.nextPosition(projectId),
        created_by: userId,
      })
      .select(SELECT)
      .single()
      .overrideTypes<DecisionCategoryRow, { merge: false }>();

    if (error || !data) {
      if (error?.code === '23505') {
        throw new ConflictException(
          `This project already has a category called "${dto.name.trim()}".`,
        );
      }
      throw new InternalServerErrorException(
        `Failed to create the category: ${error?.message ?? 'unknown error'}`,
      );
    }
    return data;
  }

  async update(
    projectId: string,
    id: string,
    userId: string,
    dto: UpdateDecisionCategoryDto,
  ) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'decisions.edit',
    );
    await this.loadOrThrow(projectId, id);

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.icon !== undefined) patch.icon = dto.icon;
    if (dto.position !== undefined) patch.position = dto.position;
    if (Object.keys(patch).length === 0) return this.loadOrThrow(projectId, id);

    const { data, error } = await this.db
      .from(TABLE)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('project_id', projectId)
      .select(SELECT)
      .single()
      .overrideTypes<DecisionCategoryRow, { merge: false }>();

    if (error || !data) {
      if (error?.code === '23505') {
        throw new ConflictException(
          'This project already has a category with that name.',
        );
      }
      throw new InternalServerErrorException(
        `Failed to update the category: ${error?.message ?? 'unknown error'}`,
      );
    }
    return data;
  }

  /**
   * Deleting is allowed even when decisions still use the category — the FK is
   * ON DELETE SET NULL, so they fall back to "Uncategorised" rather than the
   * delete being refused. `orphaned` is returned so the caller can say how many
   * that was; the web confirm dialog reads it before asking.
   */
  async remove(projectId: string, id: string, userId: string) {
    await this.authorization.assertPermission(
      userId,
      projectId,
      'decisions.edit',
    );
    await this.loadOrThrow(projectId, id);

    const { count } = await this.db
      .from(DECISIONS_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('category_id', id);

    const { error } = await this.db
      .from(TABLE)
      .delete()
      .eq('id', id)
      .eq('project_id', projectId);

    if (error) {
      throw new InternalServerErrorException(
        `Failed to delete the category: ${error.message}`,
      );
    }
    return { id, deleted: true, orphaned: count ?? 0 };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async nextPosition(projectId: string): Promise<number> {
    const { data } = await this.db
      .from(TABLE)
      .select('position')
      .eq('project_id', projectId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    return ((data?.position as number | undefined) ?? -1) + 1;
  }

  private async loadOrThrow(projectId: string, id: string) {
    const { data, error } = await this.db
      .from(TABLE)
      .select(SELECT)
      .eq('id', id)
      .eq('project_id', projectId)
      .maybeSingle()
      .overrideTypes<DecisionCategoryRow, { merge: false }>();

    if (error) {
      throw new InternalServerErrorException(
        `Failed to load the category: ${error.message}`,
      );
    }
    if (!data) throw new NotFoundException('Category not found');
    return data;
  }
}
