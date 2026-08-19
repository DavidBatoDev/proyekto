import {
  CreateRoadmapNoteDto,
  RoadmapNoteColor,
  UpdateRoadmapNoteDto,
} from '../dto/roadmap-notes.dto';

export interface RoadmapNoteRow {
  id: string;
  roadmap_id: string;
  epic_id: string | null;
  feature_id: string | null;
  task_id: string | null;
  body: string;
  color: RoadmapNoteColor;
  position_x: number | null;
  position_y: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface IRoadmapNotesRepository {
  /** Every note on a roadmap. The canvas renders them all at once. */
  listForRoadmap(roadmapId: string): Promise<RoadmapNoteRow[]>;
  findById(noteId: string): Promise<RoadmapNoteRow | null>;
  /**
   * Ids among the given epic/feature/task ids that actually belong to the
   * roadmap. Used to reject a pin target from another roadmap before the FK
   * and the RLS policy have to.
   */
  targetBelongsToRoadmap(
    roadmapId: string,
    target: {
      epic_id?: string | null;
      feature_id?: string | null;
      task_id?: string | null;
    },
  ): Promise<boolean>;
  create(
    roadmapId: string,
    dto: CreateRoadmapNoteDto,
    userId: string,
  ): Promise<RoadmapNoteRow>;
  update(noteId: string, dto: UpdateRoadmapNoteDto): Promise<RoadmapNoteRow>;
  remove(noteId: string): Promise<void>;
}
