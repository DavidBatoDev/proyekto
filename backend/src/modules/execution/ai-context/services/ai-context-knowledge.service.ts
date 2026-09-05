import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import { KnowledgeSearchService } from '../../../shared/knowledge/knowledge-search.service';
import type { IRoadmapsRepository } from '../../roadmaps/repositories/roadmaps.repository.interface';
import { ROADMAPS_REPOSITORY } from '../../roadmaps/services/roadmaps.service';
import type {
  AiContextKnowledgeSearchQueryDto,
  AiContextKnowledgeSearchResponseDto,
} from '../dto/ai-context.dto';
import {
  AI_CONTEXT_REPOSITORY,
  type IAiContextRepository,
} from '../repositories/ai-context.repository.interface';

/**
 * Cross-project knowledge retrieval for workspace-scope sessions. The
 * candidate set (`project_ids`, or everything the caller can reach) is
 * intersected with `getAccessibleProjectIds` in ONE bulk read - no per-id
 * `resolvePermissions` - and an empty intersection is a stable empty result
 * that never touches the search pipeline (the roadmap-keyed contract).
 */
@Injectable()
export class AiContextKnowledgeService {
  constructor(
    @Inject(AI_CONTEXT_REPOSITORY)
    private readonly repo: IAiContextRepository,
    @Inject(ROADMAPS_REPOSITORY)
    private readonly roadmapsRepo: IRoadmapsRepository,
    private readonly knowledgeSearch: KnowledgeSearchService,
  ) {}

  async search(
    user: AuthenticatedUser,
    query: AiContextKnowledgeSearchQueryDto,
    _traceId?: string,
  ): Promise<AiContextKnowledgeSearchResponseDto> {
    void _traceId;
    const accessible = new Set(
      await this.roadmapsRepo.getAccessibleProjectIds(user.id),
    );
    const requested = query.project_ids?.length
      ? Array.from(new Set(query.project_ids))
      : [...accessible];
    let projectIds = requested.filter((id) => accessible.has(id));

    if (query.workspace_id && projectIds.length > 0) {
      projectIds = await this.repo.filterProjectIdsByWorkspace(
        projectIds,
        query.workspace_id,
      );
    }

    if (projectIds.length === 0) {
      return { project_ids: [], query: query.q, results: [] };
    }

    const results = await this.knowledgeSearch.searchAcrossProjects({
      projectIds,
      userId: user.id,
      isGuest: !!user.is_guest,
      query: query.q,
      sources: query.sources,
      limit: query.limit,
    });

    return { project_ids: projectIds, query: query.q, results };
  }
}
