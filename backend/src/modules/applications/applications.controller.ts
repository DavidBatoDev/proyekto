import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { CreateApplicationDto } from './dto/application.dto';
export const APPLICATIONS_REPOSITORY = Symbol('APPLICATIONS_REPOSITORY');
import type { ApplicationsRepository } from './repositories/applications.repository.interface';

@Injectable()
export class ApplicationsService {
  constructor(
    @Inject(APPLICATIONS_REPOSITORY)
    private readonly appRepo: ApplicationsRepository,
  ) {}

  async getMyApplication(userId: string) {
    return this.appRepo.findByUser(userId);
  }

  async upsert(userId: string, dto: CreateApplicationDto) {
    return this.appRepo.upsert(userId, dto);
  }

  async submit(userId: string) {
    const existing = await this.appRepo.findByUser(userId);
    if (!existing)
      throw new NotFoundException('No application found. Create one first.');
    if (existing.status !== 'draft') {
      throw new BadRequestException(
        `Application is already in '${existing.status}' state and cannot be re-submitted`,
      );
    }

    // Validate required fields
    const required: (keyof typeof existing)[] = [
      'cover_letter',
      'years_of_experience',
      'primary_niche',
      'why_join',
    ];
    const missing = required.filter((field) => {
      const value = existing[field];
      if (value === null || value === undefined) return true;
      if (typeof value === 'string') return value.trim().length === 0;
      return false;
    });
    if (missing.length) {
      throw new BadRequestException(
        `Missing required fields: ${missing.join(', ')}`,
      );
    }

    return this.appRepo.submit(userId);
  }
}

@Controller('applications')
@UseGuards(SupabaseAuthGuard)
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Get('me')
  getMyApplication(@CurrentUser() user: AuthenticatedUser) {
    return this.applicationsService.getMyApplication(user.id);
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
