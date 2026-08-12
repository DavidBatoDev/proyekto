import {
  CreateFeatureDto,
  UpdateFeatureDto,
  BulkReorderDto,
  LinkMilestoneDto,
  UnlinkMilestoneDto,
  AddCommentDto,
  UpdateCommentDto,
} from '../dto/roadmaps.dto';

export interface IFeaturesRepository {
  findByEpic(epicId: string): Promise<any[]>;
  findByRoadmap(roadmapId: string): Promise<any[]>;
  findById(id: string): Promise<any | null>;
  create(dto: CreateFeatureDto, userId: string): Promise<any>;
  update(id: string, dto: UpdateFeatureDto): Promise<any>;
  bulkReorder(epicId: string, dto: BulkReorderDto): Promise<void>;
  findComments(featureId: string): Promise<any[]>;
  addComment(
    featureId: string,
    dto: AddCommentDto,
    userId: string,
  ): Promise<any>;
  updateComment(
    commentId: string,
    dto: UpdateCommentDto,
    userId: string,
  ): Promise<any>;
  deleteComment(commentId: string, userId: string): Promise<void>;
  linkMilestone(dto: LinkMilestoneDto): Promise<any>;
  unlinkMilestone(dto: UnlinkMilestoneDto): Promise<void>;
  remove(id: string): Promise<void>;
}
