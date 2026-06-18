import { ForbiddenException } from '@nestjs/common';
import { RealtimeController } from './realtime.controller';
import type { RoadmapAuthorizationService } from '../roadmaps/services/roadmap-authorization.service';
import type { ChatService } from '../chat/chat.service';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';

describe('RealtimeController', () => {
  const user = { id: 'user-1' } as AuthenticatedUser;

  const build = (over?: {
    canViewRoadmap?: jest.Mock;
    canAccessRoom?: jest.Mock;
  }) => {
    const canViewRoadmap =
      over?.canViewRoadmap ?? jest.fn().mockResolvedValue(true);
    const canAccessRoom =
      over?.canAccessRoom ?? jest.fn().mockResolvedValue(true);
    const controller = new RealtimeController(
      { canViewRoadmap } as unknown as RoadmapAuthorizationService,
      { canAccessRoom } as unknown as ChatService,
    );
    return { controller, canViewRoadmap, canAccessRoom };
  };

  it('authorizes a roadmap room the user can view', async () => {
    const { controller, canViewRoadmap } = build();
    await expect(
      controller.authorize(user, { room: 'roadmap:r1' }),
    ).resolves.toEqual({ ok: true });
    expect(canViewRoadmap).toHaveBeenCalledWith('r1', 'user-1');
  });

  it('rejects a roadmap the user cannot view', async () => {
    const { controller } = build({
      canViewRoadmap: jest.fn().mockResolvedValue(false),
    });
    await expect(
      controller.authorize(user, { room: 'roadmap:r1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('authorizes a chatroom when the user is a member', async () => {
    const { controller, canAccessRoom } = build();
    await expect(
      controller.authorize(user, { room: 'chatroom:c1' }),
    ).resolves.toEqual({ ok: true });
    expect(canAccessRoom).toHaveBeenCalledWith('c1', 'user-1');
  });

  it('rejects a chatroom the user cannot access', async () => {
    const { controller } = build({
      canAccessRoom: jest.fn().mockResolvedValue(false),
    });
    await expect(
      controller.authorize(user, { room: 'chatroom:c1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a user to join only their own inbox room', async () => {
    const { controller } = build();
    await expect(
      controller.authorize(user, { room: 'user:user-1' }),
    ).resolves.toEqual({ ok: true });
    await expect(
      controller.authorize(user, { room: 'user:someone-else' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an unknown / malformed room key', async () => {
    const { controller } = build();
    await expect(
      controller.authorize(user, { room: 'bogus' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      controller.authorize(user, { room: 'teams:t1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
