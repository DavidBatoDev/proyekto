import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ACTIVITY_ACTIONS } from '../../../shared/audit/activity-actions';
import {
  CreateRoadmapNoteDto,
  UpdateRoadmapNoteDto,
} from '../dto/roadmap-notes.dto';
import {
  IRoadmapNotesRepository,
  RoadmapNoteRow,
} from '../repositories/roadmap-notes.repository.interface';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import { RoadmapWriteEffects } from './roadmap-write-effects.service';

export const ROADMAP_NOTES_REPOSITORY = Symbol('ROADMAP_NOTES_REPOSITORY');

/** How much of a note body to carry into the activity feed as its title. */
const NOTE_TITLE_MAX_CHARS = 60;

type NotePlacementFields = Pick<
  UpdateRoadmapNoteDto,
  'epic_id' | 'feature_id' | 'task_id' | 'position_x' | 'position_y'
>;

/**
 * Sticky notes on the roadmap canvas.
 *
 * Roadmap-scoped like feature dependencies: the canvas reads every note at
 * once. Deliberately NOT part of `upsert_full_roadmap` — that RPC is an
 * editor-tier atomic structure write, and the JSON side panel saves through it,
 * so folding notes in would let an unrelated full-roadmap save silently delete
 * every collaborator's notes.
 *
 * The `:roadmapId` in the URL is untrusted, so every write authorizes against
 * it and then proves the note (and any pin target) actually belongs to it.
 */
@Injectable()
export class RoadmapNotesService {
  constructor(
    @Inject(ROADMAP_NOTES_REPOSITORY)
    private readonly repo: IRoadmapNotesRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly effects: RoadmapWriteEffects,
  ) {}

  async list(roadmapId: string, userId: string): Promise<RoadmapNoteRow[]> {
    await this.roadmapAuthz.assertCanViewRoadmap(roadmapId, userId);
    return this.repo.listForRoadmap(roadmapId);
  }

  async create(
    roadmapId: string,
    dto: CreateRoadmapNoteDto,
    userId: string,
  ): Promise<RoadmapNoteRow> {
    // COMMENT tier, not edit. A note is an annotation, and much of the point is
    // that someone who cannot restructure the plan can still mark it up.
    const ctx = await this.roadmapAuthz.assertRoadmapCommentPermission(
      roadmapId,
      userId,
    );

    this.assertPlacementShape(dto);
    await this.assertTargetInRoadmap(roadmapId, dto);

    const note = await this.repo.create(roadmapId, dto, userId);

    // `emit`, not `record`: a note IS canvas state, so peers need the publish.
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.ROADMAP_NOTE_CREATED,
      entityType: 'roadmap_note',
      entityId: note.id,
      title: this.noteTitle(note.body),
      metadata: this.placementMetadata(note),
    });

    return note;
  }

  async update(
    roadmapId: string,
    noteId: string,
    dto: UpdateRoadmapNoteDto,
    userId: string,
  ): Promise<RoadmapNoteRow> {
    const existing = await this.loadInRoadmap(roadmapId, noteId);
    const ctx = await this.assertNoteWritePermission(
      roadmapId,
      existing,
      dto,
      userId,
    );

    this.assertPlacementShape({ ...existing, ...dto });
    await this.assertTargetInRoadmap(roadmapId, dto);

    const note = await this.repo.update(noteId, dto);

    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.ROADMAP_NOTE_UPDATED,
      entityType: 'roadmap_note',
      entityId: note.id,
      title: this.noteTitle(note.body),
      metadata: this.placementMetadata(note),
    });

    return note;
  }

  async remove(
    roadmapId: string,
    noteId: string,
    userId: string,
  ): Promise<void> {
    const existing = await this.loadInRoadmap(roadmapId, noteId);
    const ctx = await this.assertCanManageNote(roadmapId, existing, userId);

    await this.repo.remove(noteId);

    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.ROADMAP_NOTE_DELETED,
      entityType: 'roadmap_note',
      entityId: noteId,
      title: this.noteTitle(existing.body),
      metadata: this.placementMetadata(existing),
    });
  }

  /**
   * 404 rather than 403 when the note belongs to another roadmap: a probe must
   * not be able to distinguish "exists elsewhere" from "does not exist".
   */
  private async loadInRoadmap(
    roadmapId: string,
    noteId: string,
  ): Promise<RoadmapNoteRow> {
    const note = await this.repo.findById(noteId);
    if (!note || note.roadmap_id !== roadmapId) {
      throw new NotFoundException('Note not found');
    }
    return note;
  }

  /**
   * Split by intent.
   *
   * Rewriting someone's words under their name is a different act from moving
   * their note, so the TEXT (and colour) is author-only while PLACEMENT is open
   * to anyone who can edit the roadmap — a note occupies canvas space everyone
   * has to look at, and the people who own what the canvas looks like need to
   * be able to tidy it.
   */
  private async assertNoteWritePermission(
    roadmapId: string,
    note: RoadmapNoteRow,
    dto: UpdateRoadmapNoteDto,
    userId: string,
  ) {
    const editsContent = dto.body !== undefined || dto.color !== undefined;

    if (editsContent) {
      if (note.created_by !== userId) {
        throw new ForbiddenException(
          'Only the author can edit a note. You can still move or remove it.',
        );
      }
      return this.roadmapAuthz.assertRoadmapCommentPermission(
        roadmapId,
        userId,
      );
    }

    return this.assertCanManageNote(roadmapId, note, userId);
  }

  /** Author, or anyone with roadmap edit rights. */
  private async assertCanManageNote(
    roadmapId: string,
    note: RoadmapNoteRow,
    userId: string,
  ) {
    if (note.created_by === userId) {
      return this.roadmapAuthz.assertRoadmapCommentPermission(
        roadmapId,
        userId,
      );
    }
    return this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.edit',
    );
  }

  /**
   * Enforce the placement invariant before the database does, so a mismatched
   * pin/unpin is a 400 with usable copy rather than a constraint violation.
   */
  private assertPlacementShape(fields: NotePlacementFields): void {
    const targets = [fields.epic_id, fields.feature_id, fields.task_id].filter(
      (id) => id != null,
    );

    if (targets.length > 1) {
      throw new BadRequestException(
        'A note can be pinned to only one epic, feature or task.',
      );
    }

    const hasCoordinates =
      fields.position_x != null && fields.position_y != null;

    if (targets.length === 0 && !hasCoordinates) {
      throw new BadRequestException(
        'A note needs either a card to pin to or a position on the canvas.',
      );
    }
    if (targets.length === 1 && hasCoordinates) {
      throw new BadRequestException(
        'A pinned note cannot also have canvas coordinates. Clear them when pinning.',
      );
    }
  }

  /**
   * A pin target from another roadmap is NOT_FOUND, matching the note lookup
   * above: the caller learns nothing about roadmaps they cannot see.
   */
  private async assertTargetInRoadmap(
    roadmapId: string,
    dto: {
      epic_id?: string | null;
      feature_id?: string | null;
      task_id?: string | null;
    },
  ): Promise<void> {
    if (!dto.epic_id && !dto.feature_id && !dto.task_id) return;
    const ok = await this.repo.targetBelongsToRoadmap(roadmapId, dto);
    if (!ok) {
      throw new NotFoundException('That card is not on this roadmap');
    }
  }

  private noteTitle(body: string): string {
    const trimmed = body.trim().replace(/\s+/g, ' ');
    return trimmed.length > NOTE_TITLE_MAX_CHARS
      ? `${trimmed.slice(0, NOTE_TITLE_MAX_CHARS)}…`
      : trimmed;
  }

  private placementMetadata(note: RoadmapNoteRow) {
    const target = note.epic_id
      ? { type: 'epic', id: note.epic_id }
      : note.feature_id
        ? { type: 'feature', id: note.feature_id }
        : note.task_id
          ? { type: 'task', id: note.task_id }
          : null;
    return {
      placement: target ? 'pinned' : 'free',
      ...(target ? { parent: target } : {}),
    };
  }
}
