import {
  PaymentCheckpoint,
  Transaction,
  Wallet,
} from '../../../common/entities';
import {
  CreatePaymentCheckpointDto,
  WalletTransactionsQueryDto,
} from '../dto/payment.dto';

export interface PaymentsRepository {
  findCheckpointsByProject(projectId: string): Promise<PaymentCheckpoint[]>;
  createCheckpoint(
    userId: string,
    dto: CreatePaymentCheckpointDto,
  ): Promise<PaymentCheckpoint>;
  markCheckpointComplete(id: string): Promise<PaymentCheckpoint>;
  fundEscrow(checkpointId: string, clientUserId: string): Promise<unknown>;
  refundEscrow(checkpointId: string): Promise<unknown>;
  getWallet(userId: string): Promise<Wallet | null>;
  getTransactions(
    userId: string,
    query: WalletTransactionsQueryDto,
  ): Promise<{ transactions: Transaction[]; total: number }>;
  adminDeposit(
    userId: string,
    amount: number,
    description?: string,
  ): Promise<unknown>;
}
