import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { FinancialsQueryDto } from './dto/financials.dto';
import { FinancialsService } from './financials.service';

@UseGuards(SupabaseAuthGuard)
@Controller('projects')
export class FinancialsController {
  constructor(private readonly financials: FinancialsService) {}

  @Get(':projectId/financials')
  getProjectFinancials(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: FinancialsQueryDto,
  ) {
    return this.financials.getProjectFinancials(user.id, projectId, {
      from: query.from,
      to: query.to,
    });
  }
}
