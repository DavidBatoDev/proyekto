import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';
import {
  AdminDepositDto,
  CreatePaymentCheckpointDto,
  WalletTransactionsQueryDto,
} from './dto/payment.dto';

@Controller('payments')
@UseGuards(SupabaseAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('project/:projectId')
  getProjectCheckpoints(@Param('projectId') projectId: string) {
    return this.paymentsService.getProjectCheckpoints(projectId);
  }

  @Post()
  createCheckpoint(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentCheckpointDto,
  ) {
    return this.paymentsService.createCheckpoint(user.id, dto);
  }

  @Patch(':id/complete')
  markComplete(@Param('id') id: string) {
    return this.paymentsService.markComplete(id);
  }

  @Post(':id/fund')
  @HttpCode(HttpStatus.OK)
  fundEscrow(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.fundEscrow(id, user.id);
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  refundEscrow(@Param('id') id: string) {
    return this.paymentsService.refundEscrow(id);
  }

  @Get('wallet')
  getWallet(@CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.getWallet(user.id);
  }

  @Get('wallet/transactions')
  getTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: WalletTransactionsQueryDto,
  ) {
    return this.paymentsService.getTransactions(user.id, query);
  }

  @Post('wallet/admin/deposit')
  @UseGuards(AdminGuard)
  adminDeposit(@Body() dto: AdminDepositDto) {
    return this.paymentsService.adminDeposit(dto);
  }
}
