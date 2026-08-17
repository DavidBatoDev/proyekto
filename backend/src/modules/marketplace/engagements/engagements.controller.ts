import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { EngagementListQueryDto } from './dto/engagements.dto';
import { EngagementsService } from './engagements.service';

/**
 * Deliberately guarded by authentication alone. Engagement access is decided by
 * party membership inside the service, which is the rule that keeps Client and
 * Talent commercial sides apart. Adding ConsultantOnlyGuard here would gate on a
 * capability instead of the position that actually owns the row, and would lock
 * Clients and Talent out of reading their own agreements.
 */
@UseGuards(SupabaseAuthGuard)
@Controller('engagements')
export class EngagementsController {
  constructor(private readonly engagements: EngagementsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: EngagementListQueryDto,
  ) {
    return this.engagements.list(user.id, query);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.engagements.getById(user.id, id);
  }
}
