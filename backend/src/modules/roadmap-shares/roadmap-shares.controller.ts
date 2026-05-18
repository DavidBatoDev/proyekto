import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SetCachePolicy } from '../../common/decorators/cache-policy.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { CACHE_POLICY_PRESETS } from '../../common/cache/cache-policy';
import { RoadmapSharesService } from './roadmap-shares.service';
import { CreateShareDto, AddShareCommentDto } from './dto/roadmap-shares.dto';

@Controller('roadmap-shares')
@UseGuards(SupabaseAuthGuard)
export class RoadmapSharesController {
  constructor(private readonly sharesService: RoadmapSharesService) {}

  @Post(':id')
  create(
    @Param('id') roadmapId: string,
    @Body() dto: CreateShareDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharesService.create(roadmapId, dto, user.id);
  }

  @Get(':id')
  getByRoadmap(@Param('id') roadmapId: string) {
    return this.sharesService.getShareByRoadmap(roadmapId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id') roadmapId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharesService.remove(roadmapId, user.id);
  }

  @Get('token/:shareToken')
  @Public()
  @SetCachePolicy(CACHE_POLICY_PRESETS.NO_STORE)
  getByToken(@Param('shareToken') token: string) {
    return this.sharesService.getByToken(token);
  }

  @Get('shared-with-me')
  getSharedWithMe(@CurrentUser() user: AuthenticatedUser) {
    return this.sharesService.getSharedWithMe(user.id);
  }

  @Post('epic/:id/comments')
  addEpicComment(
    @Param('id') epicId: string,
    @Body() dto: AddShareCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharesService.addEpicComment(epicId, dto, user?.id);
  }

  @Post('feature/:id/comments')
  addFeatureComment(
    @Param('id') featureId: string,
    @Body() dto: AddShareCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.sharesService.addFeatureComment(featureId, dto, user?.id);
  }
}
