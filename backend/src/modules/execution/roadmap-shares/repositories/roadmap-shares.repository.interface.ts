import { CreateShareDto, AddShareCommentDto } from '../dto/roadmap-shares.dto';

export interface IRoadmapSharesRepository {
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
