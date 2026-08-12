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
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { CronSecretGuard } from '../../../common/guards/cron-secret.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import { InvoicesService } from './invoices.service';
import { InvoiceSchedulerService } from './invoice-scheduler.service';
import {
  CreateInvoiceDto,
  InvoiceListQueryDto,
  RecordInvoicePaymentDto,
  ReverseInvoicePaymentDto,
  UpdateInvoiceDto,
  VoidAndReplaceInvoiceDto,
} from './dto/invoices.dto';

@UseGuards(SupabaseAuthGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly scheduler: InvoiceSchedulerService,
  ) {}

  /**
   * Scheduler-triggered (no user session): draft the invoice for every closed
   * billing period. Auth is the shared cron secret; @Public skips the Supabase
   * JWT guard, matching `POST /api/meetings/cron/reminders`.
   *
   * Declared BEFORE the `:id` routes so `cron` is never parsed as an id.
   */
  @Post('cron/run')
  @Public()
  @UseGuards(CronSecretGuard)
  @HttpCode(HttpStatus.OK)
  runScheduledInvoices() {
    return this.scheduler.runDueInvoices();
  }

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
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
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

  /**
   * Draft every closed billing period this project's contract hasn't been
   * billed for yet. Consultant-triggered counterpart to the nightly cron.
   */
  @Post('project/:projectId/generate-scheduled')
  generateScheduled(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
  ) {
    return this.scheduler.generateDraftsForProject(user.id, projectId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.invoices.deleteInvoice(user.id, id);
  }

  @Post(':id/issue')
  issue(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.invoices.issueInvoice(user.id, id);
  }

  /** Re-send an issued invoice — bounced address, or the client lost it. */
  @Post(':id/resend')
  resend(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.invoices.resendInvoiceEmail(user.id, id);
  }

  @Post(':id/payments')
  recordPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordInvoicePaymentDto,
  ) {
    return this.invoices.recordPayment(user.id, id, dto);
  }

  @Post(':id/payments/:paymentId/reverse')
  reversePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: ReverseInvoicePaymentDto,
  ) {
    return this.invoices.reversePayment(user.id, id, paymentId, dto.reason);
  }

  @Post(':id/void-and-replace')
  voidAndReplace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: VoidAndReplaceInvoiceDto,
  ) {
    return this.invoices.voidAndReplaceInvoice(user.id, id, dto.reason);
  }

  @Post(':id/generate-pdf')
  generatePdf(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.invoices.generatePdf(user.id, id);
  }

  @Get(':id/pdf-url')
  getPdfUrl(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.invoices.getPdfUrl(user.id, id);
  }

  /**
   * Where this invoice would be emailed, and which fallback supplied it. Read
   * by the pre-send confirmation so the consultant sees the actual address
   * before committing, rather than discovering it in the delivery report.
   */
  @Get(':id/recipient')
  getRecipient(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.invoices.getRecipient(user.id, id);
  }
}
