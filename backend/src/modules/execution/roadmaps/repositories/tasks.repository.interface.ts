import {
  CreateTaskDto,
  UpdateTaskDto,
  MoveTaskDto,
  BulkReorderDto,
} from '../dto/roadmaps.dto';

export interface ITasksRepository {
  findByFeature(featureId: string): Promise<any[]>;
  findByRoadmap(roadmapId: string): Promise<any[]>;
  findById(id: string): Promise<any | null>;
  create(dto: CreateTaskDto, userId: string): Promise<any>;
  update(
    id: string,
    dto: UpdateTaskDto & Partial<MoveTaskDto>,
    userId?: string,
  ): Promise<any>;
  bulkReorder(featureId: string, dto: BulkReorderDto): Promise<void>;
  bulkReorderByStatus(
    roadmapId: string,
    status: string,
    dto: BulkReorderDto,
  ): Promise<void>;
  remove(id: string): Promise<void>;
  /**
   * Newest first, at most 50. `since` (ISO timestamp) hides older rows: the
   * plan's activity retention window.
   */
  getHistory(taskId: string, opts?: { since?: string }): Promise<any[]>;
}
