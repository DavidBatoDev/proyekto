import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { KnowledgeSearchService } from '../../knowledge/knowledge-search.service';
import type {
  RoadmapAiKnowledgeSearchQueryDto,
  RoadmapAiKnowledgeSearchResponseDto,
} from '../dto/roadmap-ai-knowledge.dto';
import type { IRoadmapsRepository } from '../repositories/roadmaps.repository.interface';
import { ROADMAPS_REPOSITORY } from './roadmaps.service';

/**
 * Thin authz adapter between the roadmap AI surface and the knowledge
 * pipeline (mirrors roadmap-ai-project-context.service): read-level roadmap
 * access, 404 on denial, and a stable empty result for projectless/guest
 * roadmaps so the agent tool degrades instead of erroring.
 */
@Injectable()
export class RoadmapAiKnowledgeService {
  constructor(
    @Inject(ROADMAPS_REPOSITORY)
    private readonly roadmapsRepo: IRoadmapsRepository,
    private readonly knowledgeSearch: KnowledgeSearchService,
  ) {}

  async searchKnowledge(
    roadmapId: string,
    user: AuthenticatedUser,
    query: RoadmapAiKnowledgeSearchQueryDto,
    _traceId?: string,
  ): Promise<RoadmapAiKnowledgeSearchResponseDto> {
    void _traceId;
    const roadmap = (await this.roadmapsRepo.findById(roadmapId, user.id)) as {
      project_id?: string | null;
    } | null;
    if (!roadmap) throw new NotFoundException('Roadmap not found');

    const projectId =
      typeof roadmap.project_id === 'string' && roadmap.project_id
        ? roadmap.project_id
        : null;
    if (!projectId) {
      return { project_id: null, query: query.query, results: [] };
    }

    const results = await this.knowledgeSearch.search({
      projectId,
      userId: user.id,
      isGuest: !!user.is_guest,
      query: query.query,
      sources: query.sources,
      limit: query.limit,
    });

    return { project_id: projectId, query: query.query, results };
  }
}
