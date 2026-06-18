import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { RoadmapAuthorizationService } from '../roadmaps/services/roadmap-authorization.service';
import { ChatService } from '../chat/chat.service';
import { AuthorizeRealtimeDto } from './dto/authorize.dto';

type ParsedRoom =
  | { type: 'roadmap' | 'chatroom' | 'user'; id: string }
  | null;

function parseRoom(key: string): ParsedRoom {
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  const type = key.slice(0, idx);
  const id = key.slice(idx + 1);
  if (!id) return null;
  if (type === 'roadmap' || type === 'chatroom' || type === 'user') {
    return { type, id };
  }
  return null;
}

/**
 * Called by the realtime Worker before it lets a client join a room. Reuses the
 * exact authorization the REST API already enforces, so the Durable Object
 * transport inherits RLS-equivalent access control. Any throw (404/403) is read
 * by the Worker as "denied". A 200 means "allowed".
 */
@UseGuards(SupabaseAuthGuard)
@Controller('realtime')
export class RealtimeController {
  constructor(
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly chatService: ChatService,
  ) {}

  @Post('authorize')
  @HttpCode(200)
  async authorize(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AuthorizeRealtimeDto,
  ): Promise<{ ok: true }> {
    const parsed = parseRoom(dto.room);
    if (!parsed) throw new ForbiddenException('Invalid room');

    switch (parsed.type) {
      case 'roadmap': {
        // Joinable by anyone who can VIEW the roadmap (owner or project member)
        // — the collab room carries presence/cursors for all viewers, not just
        // editors. Mirrors findFull's access scoping.
        const allowed = await this.roadmapAuthz.canViewRoadmap(
          parsed.id,
          user.id,
        );
        if (!allowed) throw new ForbiddenException('No access to roadmap');
        return { ok: true };
      }

      case 'chatroom': {
        const allowed = await this.chatService.canAccessRoom(
          parsed.id,
          user.id,
        );
        if (!allowed) throw new ForbiddenException('No access to room');
        return { ok: true };
      }

      case 'user':
        // A user may only join their own inbox room.
        if (parsed.id !== user.id) throw new ForbiddenException('No access');
        return { ok: true };
    }
  }
}
