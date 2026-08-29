import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { CreateApplicationDto } from './dto/application.dto';
import { ApplicationsService } from './services/applications.service';

/**
 * Consultant application lifecycle, applicant side.
 *
 * Deliberately SupabaseAuthGuard only — anyone signed in may apply; the
 * consultant capability is what approval *grants*, so gating this on
 * ConsultantOnlyGuard would be circular. Admin review lives in the shared
 * admin module.
 */
@Controller('applications')
@UseGuards(SupabaseAuthGuard)
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Get('me')
  getMyApplication(@CurrentUser() user: AuthenticatedUser) {
    return this.applicationsService.getMyApplication(user.id);
  }

  @Get('eligibility')
  getEligibility(@CurrentUser() user: AuthenticatedUser) {
    return this.applicationsService.getEligibility(user.id);
  }

  @Post()
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateApplicationDto,
  ) {
    return this.applicationsService.upsert(user.id, dto);
  }

  @Post('submit')
  @HttpCode(HttpStatus.OK)
  submit(@CurrentUser() user: AuthenticatedUser) {
    return this.applicationsService.submit(user.id);
  }
}
