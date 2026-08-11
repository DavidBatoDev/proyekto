import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseArrayPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import {
  CreateFullRoadmapDto,
  JsonPatchOperationDto,
} from '../dto/patch-roadmap.dto';
import { RoadmapPatchService } from '../services/roadmap-patch.service';

@Controller('roadmaps')
@UseGuards(SupabaseAuthGuard)
export class RoadmapPatchController {
  constructor(private readonly roadmapPatchService: RoadmapPatchService) {}

  @Post('full')
  createFull(
    @Body() dto: CreateFullRoadmapDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapPatchService.createFull(dto, user.id);
  }

  @Patch(':id/json-patch')
  @HttpCode(HttpStatus.OK)
  applyJsonPatch(
    @Param('id') id: string,
    @Body(new ParseArrayPipe({ items: JsonPatchOperationDto }))
    operations: JsonPatchOperationDto[],
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.roadmapPatchService.applyPatch(id, operations, user.id);
  }
}
