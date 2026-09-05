import { Injectable } from '@nestjs/common';
import type {
  RoadmapAiProjectBriefResponseDto,
  RoadmapAiProjectContextDto,
  RoadmapAiProjectMeetingsQueryDto,
  RoadmapAiProjectMeetingsResponseDto,
  RoadmapAiProjectMemberDetailsResponseDto,
  RoadmapAiProjectResourcesResponseDto,
} from '../../roadmaps/dto/roadmap-ai-project-context.dto';
import { RoadmapAiProjectContextService } from '../../roadmaps/services/roadmap-ai-project-context.service';
import type { AiContextProjectMembersResponseDto } from '../dto/ai-context.dto';

/**
 * Project-keyed context for sessions that hold a project id but no focus
 * roadmap. Thin by design: authorization (owner or any `project_access` row,
 * else 404 - never 403, so existence never leaks) and the payload readers
 * live in `RoadmapAiProjectContextService`, whose roadmap-keyed twins serve
 * the in-roadmap assistant with byte-identical shapes.
 */
@Injectable()
export class AiContextProjectService {
  constructor(
    private readonly projectContext: RoadmapAiProjectContextService,
  ) {}

  getContext(
    projectId: string,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiProjectContextDto> {
    return this.projectContext.getProjectContextForProject(
      projectId,
      userId,
      traceId,
    );
  }

  getBrief(
    projectId: string,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiProjectBriefResponseDto> {
    return this.projectContext.getProjectBriefForProject(
      projectId,
      userId,
      traceId,
    );
  }

  getResources(
    projectId: string,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiProjectResourcesResponseDto> {
    return this.projectContext.getProjectResourcesForProject(
      projectId,
      userId,
      traceId,
    );
  }

  getMeetings(
    projectId: string,
    userId: string,
    query: RoadmapAiProjectMeetingsQueryDto,
    traceId?: string,
  ): Promise<RoadmapAiProjectMeetingsResponseDto> {
    return this.projectContext.getProjectMeetingsForProject(
      projectId,
      userId,
      query,
      traceId,
    );
  }

  /**
   * The compact member list (owner first, then `project_access`), the same
   * rows the context pack carries, for the agent's `list_project_members`.
   */
  async listMembers(
    projectId: string,
    userId: string,
    traceId?: string,
  ): Promise<AiContextProjectMembersResponseDto> {
    const context = await this.projectContext.getProjectContextForProject(
      projectId,
      userId,
      traceId,
    );
    return { project_id: projectId, members: context.members };
  }

  getMemberDetails(
    projectId: string,
    memberId: string,
    userId: string,
    traceId?: string,
  ): Promise<RoadmapAiProjectMemberDetailsResponseDto> {
    return this.projectContext.getMemberDetailsForProject(
      projectId,
      memberId,
      userId,
      traceId,
    );
  }
}
