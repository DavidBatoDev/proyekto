import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import {
  CreateRoadmapNoteDto,
  UpdateRoadmapNoteDto,
} from '../dto/roadmap-notes.dto';
import { RoadmapNotesService } from '../services/roadmap-notes.service';

/**
 * Roadmap-scoped because the canvas renders every note at once. Deliberately
 * separate from the roadmap "full" payload and from `upsert_full_roadmap` —
 * see the service docstring for why.
 */
@Controller('roadmaps/:roadmapId/notes')
@UseGuards(SupabaseAuthGuard)
export class RoadmapNotesController {
  constructor(private readonly service: RoadmapNotesService) {}

  @Get()
  list(
    @Param('roadmapId') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(roadmapId, user.id);
  }

  @Post()
  create(
    @Param('roadmapId') roadmapId: string,
    @Body() dto: CreateRoadmapNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(roadmapId, dto, user.id);
  }

  @Patch(':noteId')
  update(
    @Param('roadmapId') roadmapId: string,
    @Param('noteId') noteId: string,
    @Body() dto: UpdateRoadmapNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(roadmapId, noteId, dto, user.id);
  }

  @Delete(':noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('roadmapId') roadmapId: string,
    @Param('noteId') noteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(roadmapId, noteId, user.id);
  }
}
