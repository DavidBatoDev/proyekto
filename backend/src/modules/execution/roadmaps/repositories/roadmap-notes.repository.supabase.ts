import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import {
  CreateRoadmapNoteDto,
  UpdateRoadmapNoteDto,
} from '../dto/roadmap-notes.dto';
import {
  IRoadmapNotesRepository,
  RoadmapNoteRow,
} from './roadmap-notes.repository.interface';

/**
 * The table's invariants come back as Postgres constraint violations. Translate
 * them here, where the raw error still exists, into something the client can
 * act on — otherwise a half-applied pin/unpin reaches the user as an opaque
 * 500. Messages mirror the CHECK names in
 * 20260819150000_create_roadmap_notes.sql.
 */
function translateWriteError(error: { message?: string } | null): never | void {
  if (!error) return;
  const message = error.message ?? '';

  if (message.includes('roadmap_notes_placement_shape')) {
    throw new BadRequestException(
      'A note is either pinned to a card or placed on the canvas, not both. Send the target and the coordinates together.',
    );
  }
  if (message.includes('roadmap_notes_at_most_one_target')) {
    throw new BadRequestException(
      'A note can be pinned to only one epic, feature or task.',
    );
  }
  if (message.includes('roadmap_notes_position_bounds')) {
    throw new BadRequestException(
      'That position is outside the canvas bounds.',
    );
  }
  if (message.includes('roadmap_notes_body_not_blank')) {
    throw new BadRequestException('A note cannot be empty.');
  }
  throw new Error(message);
}

/** Shape of an untyped supabase-js response, so results destructure safely. */
interface SupabaseResult<T> {
  data: T;
  error: { message: string } | null;
}

@Injectable()
export class RoadmapNotesRepositorySupabase implements IRoadmapNotesRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  private static readonly SELECT =
    '*, author:profiles!created_by(id, display_name, avatar_url)';

  async listForRoadmap(roadmapId: string): Promise<RoadmapNoteRow[]> {
    const { data, error } = (await this.db
      .from('roadmap_notes')
      .select(RoadmapNotesRepositorySupabase.SELECT)
      .eq('roadmap_id', roadmapId)
      .order('created_at', {
        ascending: true,
      })) as SupabaseResult<RoadmapNoteRow[] | null>;
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async findById(noteId: string): Promise<RoadmapNoteRow | null> {
    const { data, error } = (await this.db
      .from('roadmap_notes')
      .select(RoadmapNotesRepositorySupabase.SELECT)
      .eq('id', noteId)
      .maybeSingle()) as SupabaseResult<RoadmapNoteRow | null>;
    if (error) throw new Error(error.message);
    return data ?? null;
  }

  async targetBelongsToRoadmap(
    roadmapId: string,
    target: {
      epic_id?: string | null;
      feature_id?: string | null;
      task_id?: string | null;
    },
  ): Promise<boolean> {
    if (target.epic_id) {
      const { data, error } = (await this.db
        .from('roadmap_epics')
        .select('id')
        .eq('id', target.epic_id)
        .eq('roadmap_id', roadmapId)
        .maybeSingle()) as SupabaseResult<{ id: string } | null>;
      if (error) throw new Error(error.message);
      return Boolean(data);
    }
    if (target.feature_id) {
      // roadmap_features carries a denormalized roadmap_id, so this is one hop.
      const { data, error } = (await this.db
        .from('roadmap_features')
        .select('id')
        .eq('id', target.feature_id)
        .eq('roadmap_id', roadmapId)
        .maybeSingle()) as SupabaseResult<{ id: string } | null>;
      if (error) throw new Error(error.message);
      return Boolean(data);
    }
    if (target.task_id) {
      // roadmap_tasks has NO roadmap_id, so this one walks up to its feature.
      const { data, error } = (await this.db
        .from('roadmap_tasks')
        .select(
          'id, feature:roadmap_features!roadmap_tasks_feature_id_fkey(roadmap_id)',
        )
        .eq('id', target.task_id)
        .maybeSingle()) as SupabaseResult<{ feature?: unknown } | null>;
      if (error) throw new Error(error.message);
      if (!data) return false;
      const embedded = data.feature;
      const feature = (Array.isArray(embedded) ? embedded[0] : embedded) as
        | { roadmap_id?: string | null }
        | null
        | undefined;
      return feature?.roadmap_id === roadmapId;
    }
    // No target at all: a free-floating note, nothing to verify.
    return true;
  }

  async create(
    roadmapId: string,
    dto: CreateRoadmapNoteDto,
    userId: string,
  ): Promise<RoadmapNoteRow> {
    const { data, error } = (await this.db
      .from('roadmap_notes')
      .insert({
        roadmap_id: roadmapId,
        body: dto.body,
        color: dto.color ?? 'yellow',
        epic_id: dto.epic_id ?? null,
        feature_id: dto.feature_id ?? null,
        task_id: dto.task_id ?? null,
        position_x: dto.position_x ?? null,
        position_y: dto.position_y ?? null,
        created_by: userId,
      })
      .select(RoadmapNotesRepositorySupabase.SELECT)
      .single()) as SupabaseResult<RoadmapNoteRow>;
    if (error) translateWriteError(error);
    return data;
  }

  async update(
    noteId: string,
    dto: UpdateRoadmapNoteDto,
  ): Promise<RoadmapNoteRow> {
    // Only send what the caller actually set: a PATCH that omits `color` must
    // not reset it, and a PATCH that explicitly sends `epic_id: null` must.
    const patch: Record<string, unknown> = {};
    if (dto.body !== undefined) patch.body = dto.body;
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.epic_id !== undefined) patch.epic_id = dto.epic_id;
    if (dto.feature_id !== undefined) patch.feature_id = dto.feature_id;
    if (dto.task_id !== undefined) patch.task_id = dto.task_id;
    if (dto.position_x !== undefined) patch.position_x = dto.position_x;
    if (dto.position_y !== undefined) patch.position_y = dto.position_y;

    const { data, error } = (await this.db
      .from('roadmap_notes')
      .update(patch)
      .eq('id', noteId)
      .select(RoadmapNotesRepositorySupabase.SELECT)
      .single()) as SupabaseResult<RoadmapNoteRow>;
    if (error) translateWriteError(error);
    return data;
  }

  async remove(noteId: string): Promise<void> {
    const { error } = await this.db
      .from('roadmap_notes')
      .delete()
      .eq('id', noteId);
    if (error) throw new Error(error.message);
  }
}
