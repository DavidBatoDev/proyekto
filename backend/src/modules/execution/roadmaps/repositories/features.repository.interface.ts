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
  /**
   * The comment's parent id, author and CURRENT body, read before an edit.
   *
   * Exists so an edit can notify people newly @mentioned in it — the diff needs
   * the previous body — and so the service can run the roadmap authorization
   * walk that this path never had. Returns null when the comment is gone.
   */
  findCommentContext(commentId: string): Promise<{
    feature_id: string;
    user_id: string | null;
    content: string;
  } | null>;
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
