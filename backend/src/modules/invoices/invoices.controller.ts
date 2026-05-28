import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import { InvoicesService } from './invoices.service';
import {
  CreateInvoiceDto,
  InvoiceListQueryDto,
  UpdateInvoiceDto,
} from './dto/invoices.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('project/:projectId')
  listByProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query() query: InvoiceListQueryDto,
  ) {
    return this.invoices.listProjectInvoices(user.id, projectId, query);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.invoices.createInvoice(user.id, dto);
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.invoices.getInvoice(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ) {
    return this.invoices.updateInvoice(user.id, id, dto);
  }

  @Post(':id/issue')
  issue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.invoices.issueInvoice(user.id, id);
  }

  @Post(':id/generate-pdf')
  generatePdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.invoices.generatePdf(user.id, id);
  }
}
