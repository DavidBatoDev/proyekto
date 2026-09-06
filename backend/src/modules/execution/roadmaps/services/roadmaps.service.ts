import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { MissingPermissionException } from '../../projects/authorization/missing-permission.exception';
import type { IRoadmapsRepository } from '../repositories/roadmaps.repository.interface';
import { countRoadmapChildren } from '../repositories/roadmaps.repository.supabase';
import { CreateRoadmapDto, UpdateRoadmapDto } from '../dto/roadmaps.dto';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';

export const ROADMAPS_REPOSITORY = Symbol('ROADMAPS_REPOSITORY');

@Injectable()
export class RoadmapsService {
  private readonly logger = new Logger(RoadmapsService.name);

  constructor(
    @Inject(ROADMAPS_REPOSITORY) private readonly repo: IRoadmapsRepository,
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
  ) {}

  async replaceProjectRoadmap(
    projectId: string,
    replacementRoadmapId: string,
    userId: string,
  ) {
    await this.roadmapAuthz.assertProjectRoadmapPermission(
      projectId,
      userId,
      'roadmap.edit',
    );

    const current = await this.repo.findByProjectId(projectId, userId);
    if (!current) {
      throw new NotFoundException(
        'No roadmap is currently linked to this project.',
      );
    }

    const totalChildren = await countRoadmapChildren(this.supabase, current.id);
    if (totalChildren > 0) {
      throw new BadRequestException(
        'Current roadmap is not empty; only empty roadmaps can be replaced.',
      );
    }

    if (replacementRoadmapId === current.id) {
      throw new BadRequestException(
        'Replacement roadmap must differ from the current roadmap.',
      );
    }

    const replacement = await this.repo.findById(replacementRoadmapId);
    if (!replacement) {
      throw new NotFoundException('Replacement roadmap not found');
    }
    if (replacement.owner_id !== userId) {
      throw new ForbiddenException('You can only link a roadmap you own.');
    }
    if (replacement.project_id) {
      throw new BadRequestException(
        'Replacement roadmap is already linked to a project.',
      );
    }

    const { data: linked, error } = await this.supabase
      .rpc('replace_project_roadmap', {
        p_project_id: projectId,
        p_current_roadmap_id: current.id,
        p_replacement_roadmap_id: replacementRoadmapId,
        p_user_id: userId,
      })
      .returns<Record<string, unknown>>();
    if (error || !linked) {
      if (error?.code === 'PT409' || error?.code === '23505') {
        throw new ConflictException(
          'A roadmap link changed while replacing it. Refresh and try again.',
        );
      }
      if (error?.code === '22023') {
        throw new BadRequestException(error.message);
      }
      this.logger.error(`Failed to replace project roadmap: ${error?.message}`);
      throw new BadRequestException(
        'Could not replace the roadmap. Please refresh and try again.',
      );
    }

    return linked;
  }

  async findAll(userId: string) {
    return this.repo.findAll(userId);
  }

  async getAllFull(userId: string) {
    return this.repo.findAllFull(userId);
  }

  async findPreviews(userId: string) {
    return this.repo.findPreviews(userId);
  }

  async findByUser(userId: string, callerId: string) {
    // Prevent enumerating another registered user's roadmaps by UUID. The one
    // legitimate cross-user case is the guest→account migration preview, where
    // the caller lists a *guest* profile's roadmaps before claiming them
    // (the claim itself is session-validated in migrateGuestRoadmaps).
    if (userId !== callerId) {
      const { data } = await this.supabase
        .from('profiles')
        .select('is_guest')
        .eq('id', userId)
        .maybeSingle();
      if (!data?.is_guest) {
        throw new ForbiddenException('You can only list your own roadmaps.');
      }
    }
    return this.repo.findByUser(userId);
  }

  async findByProjectId(projectId: string, userId: string) {
    const roadmap = await this.repo.findByProjectId(projectId, userId);
    if (!roadmap) throw new NotFoundException('Roadmap not found');
    return roadmap;
  }

  async findById(id: string, userId: string) {
    const roadmap = await this.repo.findById(id, userId);
    if (!roadmap) throw new NotFoundException('Roadmap not found');
    return roadmap;
  }

  async findFull(id: string, userId: string) {
    // NOTE: this used to pass `{ includeTaskCommentCount: true }`, an option
    // the repository never read — so `comment_count` never reached the client
    // and the canvas's comment badge was dead UI. Counts now come from
    // GET /roadmaps/:roadmapId/comment-summary instead.
    const roadmap = await this.repo.findFull(id, userId);
    if (!roadmap) throw new NotFoundException('Roadmap not found');
    return roadmap;
  }

  async create(dto: CreateRoadmapDto, userId: string) {
    if (dto.project_id) {
      await this.roadmapAuthz.assertProjectRoadmapPermission(
        dto.project_id,
        userId,
        'roadmap.edit',
      );
      await this.assertProjectHasNoRoadmap(dto.project_id);
    }
    return this.repo.create(dto, userId);
  }

  async update(id: string, dto: UpdateRoadmapDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Roadmap not found');

    // Re-homing a roadmap under a project is a link, not a plain field edit:
    // the caller must be allowed to edit that project's roadmap, the project
    // must not have one yet (one-to-one), and an already-linked roadmap is
    // moved only through the replace-for-project flow.
    const targetProjectId =
      typeof dto.project_id === 'string' &&
      dto.project_id !== existing.project_id
        ? dto.project_id
        : null;
    if (targetProjectId) {
      if (existing.project_id) {
        throw new BadRequestException(
          'Roadmap is already linked to a project.',
        );
      }
      await this.roadmapAuthz.assertProjectRoadmapPermission(
        targetProjectId,
        userId,
        'roadmap.edit',
      );
      await this.assertProjectHasNoRoadmap(targetProjectId);
    }

    if (existing.project_id) {
      await this.roadmapAuthz.assertRoadmapPermission(
        id,
        userId,
        'roadmap.edit',
      );
      return this.repo.update(id, dto);
    }

    if (existing.owner_id !== userId)
      throw new MissingPermissionException({
        path: null,
        requiredRole: 'owner',
        label: 'modify this roadmap',
      });
    return this.repo.update(id, dto);
  }

  /**
   * A project holds at most one linked roadmap (`uq_roadmaps_project_id_linked`).
   * Checked up front so callers get a 409 they can act on instead of the
   * unique-violation 500 the insert would otherwise surface.
   */
  private async assertProjectHasNoRoadmap(projectId: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('roadmaps')
      .select('id, name')
      .eq('project_id', projectId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) {
      throw new ConflictException({
        code: 'PROJECT_ALREADY_HAS_ROADMAP',
        message: `This project already has a roadmap (${String(
          (data as { name?: string }).name ?? 'untitled',
        )}). A project holds exactly one roadmap.`,
        roadmap_id: (data as { id: string }).id,
      });
    }
  }

  async remove(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Roadmap not found');

    if (existing.project_id) {
      await this.roadmapAuthz.assertRoadmapPermission(
        id,
        userId,
        'roadmap.edit',
      );
      await this.repo.remove(id);
      return;
    }

    if (existing.owner_id !== userId)
      throw new MissingPermissionException({
        path: null,
        requiredRole: 'owner',
        label: 'modify this roadmap',
      });
    await this.repo.remove(id);
  }

  async migrateGuestRoadmaps(sessionId: string, userId: string) {
    return this.repo.migrateGuestRoadmaps(sessionId, userId);
  }
}
