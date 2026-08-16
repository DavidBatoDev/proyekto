import { CreateShareDto, AddShareCommentDto } from '../dto/roadmap-shares.dto';

export interface IRoadmapSharesRepository {
  findPreviewMetadata(
    roadmapId: string,
    nodeId: string,
  ): Promise<{
    roadmap_id: string;
    project_id: string | null;
    roadmap_name: string;
    node_id: string;
    node_type: 'epic' | 'feature' | 'task';
    node_title: string;
  } | null>;
  findByRoadmap(roadmapId: string): Promise<any | null>;
  findByToken(token: string): Promise<any | null>;
  findSharedWithMe(userId: string): Promise<any[]>;
  create(roadmapId: string, dto: CreateShareDto, userId: string): Promise<any>;
  remove(roadmapId: string, userId: string): Promise<void>;
  addEpicComment(
    epicId: string,
    dto: AddShareCommentDto,
    userId?: string,
  ): Promise<any>;
  addFeatureComment(
    featureId: string,
    dto: AddShareCommentDto,
    userId?: string,
  ): Promise<any>;
}
