import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ConsultantOnlyGuard } from '../../../common/guards/consultant-only.guard';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { ConsultantServicesService } from './consultant-services.service';
import {
  CreateConsultantServiceDto,
  ReorderConsultantServicesDto,
  UpdateConsultantServiceDto,
} from './dto/consultant-services.dto';

/**
 * A consultant's own service catalog.
 *
 * Consultant-exclusive by design, which is why it is its own controller rather
 * than more routes on `/api/profile`. That one is the ACCOUNT-level surface
 * shared with freelancers — skills, rates, experience — and putting a
 * `ConsultantOnlyGuard` route inside it would make half of it
 * consultant-only and invite the next person to add a consultant field to
 * `UpdateProfileBasicDto`.
 *
 * Public reads live on `/api/consultants/:id`; nothing here is public.
 */
@Controller('consultant-services')
@UseGuards(SupabaseAuthGuard, ConsultantOnlyGuard)
export class ConsultantServicesController {
  constructor(private readonly services: ConsultantServicesService) {}

  /** The owner's whole catalog, drafts included. Also feeds the contract picker. */
  @Get('mine')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.services.listMine(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateConsultantServiceDto,
  ) {
    return this.services.create(user.id, dto);
  }

  // Declared before `:id` so it is not swallowed by the param route — Nest
  // matches in declaration order.
  @Put('reorder')
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReorderConsultantServicesDto,
  ) {
    return this.services.reorder(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConsultantServiceDto,
  ) {
    return this.services.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.services.remove(user.id, id);
  }
}
