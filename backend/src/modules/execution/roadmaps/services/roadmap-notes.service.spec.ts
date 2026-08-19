import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RoadmapNotesService } from './roadmap-notes.service';
import type { RoadmapNoteRow } from '../repositories/roadmap-notes.repository.interface';

describe('RoadmapNotesService', () => {
  const roadmapId = 'rm-1';
  const author = 'u-author';
  const other = 'u-other';

  const note = (over: Partial<RoadmapNoteRow> = {}): RoadmapNoteRow => ({
    id: 'n-1',
    roadmap_id: roadmapId,
    epic_id: null,
    feature_id: null,
    task_id: null,
    body: 'Blocked on the Stripe test key',
    color: 'yellow',
    position_x: 120,
    position_y: 240,
    created_by: author,
    created_at: '2026-08-19T10:00:00.000Z',
    updated_at: '2026-08-19T10:00:00.000Z',
    ...over,
  });

  function build(
    over: {
      findById?: jest.Mock;
      targetBelongsToRoadmap?: jest.Mock;
      assertRoadmapCommentPermission?: jest.Mock;
      assertRoadmapPermission?: jest.Mock;
      assertCanViewRoadmap?: jest.Mock;
    } = {},
  ) {
    const ctx = {
      roadmapId,
      projectId: 'p-1',
      ownerId: author,
      permissions: null,
    };
    const repo = {
      listForRoadmap: jest.fn().mockResolvedValue([note()]),
      findById: over.findById ?? jest.fn().mockResolvedValue(note()),
      targetBelongsToRoadmap:
        over.targetBelongsToRoadmap ?? jest.fn().mockResolvedValue(true),
      create: jest.fn(async (_r, dto) => note(dto as Partial<RoadmapNoteRow>)),
      update: jest.fn(async (_id, dto) => note(dto as Partial<RoadmapNoteRow>)),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const roadmapAuthz = {
      assertCanViewRoadmap:
        over.assertCanViewRoadmap ?? jest.fn().mockResolvedValue(undefined),
      assertRoadmapCommentPermission:
        over.assertRoadmapCommentPermission ?? jest.fn().mockResolvedValue(ctx),
      assertRoadmapPermission:
        over.assertRoadmapPermission ?? jest.fn().mockResolvedValue(ctx),
    };
    const effects = { emit: jest.fn(), record: jest.fn(), touch: jest.fn() };
    const service = new RoadmapNotesService(
      repo as never,
      roadmapAuthz as never,
      effects as never,
    );
    return { service, repo, roadmapAuthz, effects };
  }

  describe('create', () => {
    it('authorizes at the COMMENT tier, not the edit tier', async () => {
      // The point of a sticky note is that someone who cannot restructure the
      // plan can still mark it up.
      const { service, roadmapAuthz } = build();

      await service.create(
        roadmapId,
        { body: 'note', position_x: 10, position_y: 20 },
        author,
      );

      expect(roadmapAuthz.assertRoadmapCommentPermission).toHaveBeenCalledWith(
        roadmapId,
        author,
      );
      expect(roadmapAuthz.assertRoadmapPermission).not.toHaveBeenCalled();
    });

    it('emits rather than merely recording — a note IS canvas state', async () => {
      const { service, effects } = build();

      await service.create(
        roadmapId,
        { body: 'note', position_x: 10, position_y: 20 },
        author,
      );

      expect(effects.emit).toHaveBeenCalled();
      expect(effects.record).not.toHaveBeenCalled();
    });

    it('rejects a note with neither a target nor coordinates', async () => {
      const { service } = build();

      await expect(
        service.create(roadmapId, { body: 'nowhere' }, author),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a pinned note that also carries coordinates', async () => {
      const { service } = build();

      await expect(
        service.create(
          roadmapId,
          { body: 'both', epic_id: 'e-1', position_x: 1, position_y: 2 },
          author,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a note pinned to more than one card', async () => {
      const { service } = build();

      await expect(
        service.create(
          roadmapId,
          { body: 'two', epic_id: 'e-1', feature_id: 'f-1' },
          author,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s a pin target from another roadmap, so a probe learns nothing', async () => {
      const { service } = build({
        targetBelongsToRoadmap: jest.fn().mockResolvedValue(false),
      });

      await expect(
        service.create(
          roadmapId,
          { body: 'x', epic_id: 'e-elsewhere' },
          author,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('lets the author edit the text', async () => {
      const { service, repo } = build();

      await service.update(roadmapId, 'n-1', { body: 'reworded' }, author);

      expect(repo.update).toHaveBeenCalled();
    });

    it('refuses to let a non-author rewrite someone else’s words', async () => {
      const { service, repo } = build();

      await expect(
        service.update(roadmapId, 'n-1', { body: 'hijacked' }, other),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('lets a roadmap editor MOVE a note they did not write', async () => {
      // A note occupies canvas space everyone has to look at, so whoever owns
      // the canvas has to be able to tidy it — even though the text is not
      // theirs to change.
      const { service, roadmapAuthz, repo } = build();

      await service.update(
        roadmapId,
        'n-1',
        { position_x: 900, position_y: 80 },
        other,
      );

      expect(roadmapAuthz.assertRoadmapPermission).toHaveBeenCalledWith(
        roadmapId,
        other,
        'roadmap.edit',
      );
      expect(repo.update).toHaveBeenCalled();
    });

    it('rejects a pin that does not clear the coordinates in the same patch', async () => {
      // The note starts free-floating with coordinates; pinning it without
      // nulling them would violate roadmap_notes_placement_shape.
      const { service } = build();

      await expect(
        service.update(roadmapId, 'n-1', { epic_id: 'e-1' }, author),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a pin that clears the coordinates', async () => {
      const { service, repo } = build();

      await service.update(
        roadmapId,
        'n-1',
        { epic_id: 'e-1', position_x: null, position_y: null },
        author,
      );

      expect(repo.update).toHaveBeenCalled();
    });

    it('404s a note that belongs to a different roadmap', async () => {
      const { service } = build({
        findById: jest.fn().mockResolvedValue(note({ roadmap_id: 'rm-other' })),
      });

      await expect(
        service.update(roadmapId, 'n-1', { body: 'x' }, author),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('lets the author delete their own note', async () => {
      const { service, repo } = build();

      await service.remove(roadmapId, 'n-1', author);

      expect(repo.remove).toHaveBeenCalledWith('n-1');
    });

    it('lets a roadmap editor delete a note they did not write', async () => {
      const { service, roadmapAuthz, repo } = build();

      await service.remove(roadmapId, 'n-1', other);

      expect(roadmapAuthz.assertRoadmapPermission).toHaveBeenCalledWith(
        roadmapId,
        other,
        'roadmap.edit',
      );
      expect(repo.remove).toHaveBeenCalled();
    });

    it('404s a note from another roadmap without deleting anything', async () => {
      const { service, repo } = build({
        findById: jest.fn().mockResolvedValue(note({ roadmap_id: 'rm-other' })),
      });

      await expect(
        service.remove(roadmapId, 'n-1', author),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.remove).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('requires view access before reading', async () => {
      const deny = jest.fn().mockRejectedValue(new ForbiddenException());
      const { service, repo } = build({ assertCanViewRoadmap: deny });

      await expect(service.list(roadmapId, other)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.listForRoadmap).not.toHaveBeenCalled();
    });
  });
});
