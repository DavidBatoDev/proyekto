import {
  CreateMilestoneDto,
  UpdateMilestoneDto,
  ReorderDto,
} from '../dto/roadmaps.dto';

export interface IMilestonesRepository {
  findByRoadmap(roadmapId: string): Promise<any[]>;
  findById(id: string): Promise<any | null>;
  create(
    roadmapId: string,
    dto: CreateMilestoneDto,
    userId: string,
  ): Promise<any>;
  update(id: string, dto: UpdateMilestoneDto): Promise<any>;
  reorder(id: string, dto: ReorderDto): Promise<any>;
  remove(id: string): Promise<void>;
}
