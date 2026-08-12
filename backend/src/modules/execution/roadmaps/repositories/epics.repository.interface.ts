import {
  CreateEpicDto,
  UpdateEpicDto,
  BulkReorderDto,
  AddCommentDto,
  UpdateCommentDto,
} from '../dto/roadmaps.dto';

export interface IEpicsRepository {
  findByRoadmap(roadmapId: string): Promise<any[]>;
  findById(id: string): Promise<any | null>;
  create(dto: CreateEpicDto, userId: string): Promise<any>;
  update(id: string, dto: UpdateEpicDto): Promise<any>;
  bulkReorder(roadmapId: string, dto: BulkReorderDto): Promise<void>;
  findComments(epicId: string): Promise<any[]>;
  addComment(epicId: string, dto: AddCommentDto, userId: string): Promise<any>;
  updateComment(
    commentId: string,
    dto: UpdateCommentDto,
    userId: string,
  ): Promise<any>;
  deleteComment(commentId: string, userId: string): Promise<void>;
  remove(id: string): Promise<void>;
}
