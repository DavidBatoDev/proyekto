import {
  CreateTaskDto,
  UpdateTaskDto,
  BulkReorderDto,
} from '../dto/roadmaps.dto';

export interface ITasksRepository {
  findByFeature(featureId: string): Promise<any[]>;
  findByRoadmap(roadmapId: string): Promise<any[]>;
  findById(id: string): Promise<any | null>;
  create(dto: CreateTaskDto, userId: string): Promise<any>;
  update(id: string, dto: UpdateTaskDto): Promise<any>;
  bulkReorder(featureId: string, dto: BulkReorderDto): Promise<void>;
  remove(id: string): Promise<void>;
}
