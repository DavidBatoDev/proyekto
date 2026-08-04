import { Inject, Injectable, NotFoundException } from '@nestjs/common';
export const PAYMENTS_REPOSITORY = Symbol('PAYMENTS_REPOSITORY');
import type { PaymentsRepository } from './repositories/payments.repository.interface';
import {
  AdminDepositDto,
  CreatePaymentCheckpointDto,
  WalletTransactionsQueryDto,
} from './dto/payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PAYMENTS_REPOSITORY)
    private readonly paymentsRepo: PaymentsRepository,
  ) {}

  async getProjectCheckpoints(projectId: string) {
    return this.paymentsRepo.findCheckpointsByProject(projectId);
  }

  async createCheckpoint(userId: string, dto: CreatePaymentCheckpointDto) {
    return this.paymentsRepo.createCheckpoint(userId, dto);
  }

  async markComplete(id: string) {
    return this.paymentsRepo.markCheckpointComplete(id);
  }

  async fundEscrow(checkpointId: string, userId: string) {
    return this.paymentsRepo.fundEscrow(checkpointId, userId);
  }

  async refundEscrow(checkpointId: string) {
    return this.paymentsRepo.refundEscrow(checkpointId);
  }

  async getWallet(userId: string) {
    const wallet = await this.paymentsRepo.getWallet(userId);
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  async getTransactions(userId: string, query: WalletTransactionsQueryDto) {
    return this.paymentsRepo.getTransactions(userId, query);
  }

  async adminDeposit(dto: AdminDepositDto) {
    return this.paymentsRepo.adminDeposit(
      dto.user_id,
      dto.amount,
      dto.description,
    );
  }
}
