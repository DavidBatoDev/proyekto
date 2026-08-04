import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { PaymentsRepository } from './payments.repository.interface';
import {
  PaymentCheckpoint,
  Transaction,
  Wallet,
} from '../../../common/entities';
import {
  CreatePaymentCheckpointDto,
  WalletTransactionsQueryDto,
} from '../dto/payment.dto';

@Injectable()
export class SupabasePaymentsRepository implements PaymentsRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async findCheckpointsByProject(
    projectId: string,
  ): Promise<PaymentCheckpoint[]> {
    const { data } = await this.supabase
      .from('payment_checkpoints')
      .select(
        '*, milestone:milestones(*), payer:profiles!payment_checkpoints_payer_id_fkey(id, display_name), payee:profiles!payment_checkpoints_payee_id_fkey(id, display_name)',
      )
      .eq('project_id', projectId)
      .order('created_at');
    return (data || []) as PaymentCheckpoint[];
  }

  async createCheckpoint(
    userId: string,
    dto: CreatePaymentCheckpointDto,
  ): Promise<PaymentCheckpoint> {
    const { data, error } = await this.supabase
      .from('payment_checkpoints')
      .insert({ ...dto, payer_id: userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as PaymentCheckpoint;
  }

  async markCheckpointComplete(id: string): Promise<PaymentCheckpoint> {
    const { data, error } = await this.supabase
      .from('payment_checkpoints')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error || !data)
      throw new NotFoundException('Payment checkpoint not found');
    return data as PaymentCheckpoint;
  }

  async fundEscrow(
    checkpointId: string,
    clientUserId: string,
  ): Promise<unknown> {
    const { data, error } = await this.supabase.rpc('fund_escrow', {
      p_checkpoint_id: checkpointId,
      p_client_user_id: clientUserId,
    });
    if (error) throw new Error(error.message);
    return data;
  }

  async refundEscrow(checkpointId: string): Promise<unknown> {
    const { data, error } = await this.supabase.rpc('refund_escrow', {
      p_checkpoint_id: checkpointId,
    });
    if (error) throw new Error(error.message);
    return data;
  }

  async getWallet(userId: string): Promise<Wallet | null> {
    const { data } = await this.supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .single();
    return (data as Wallet) || null;
  }

  async getTransactions(
    userId: string,
    query: WalletTransactionsQueryDto,
  ): Promise<{ transactions: Transaction[]; total: number }> {
    const { page = 1, limit = 20, type, project_id } = query;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const wallet = await this.getWallet(userId);
    if (!wallet) return { transactions: [], total: 0 };

    let q = this.supabase
      .from('transactions')
      .select(
        '*, project:projects(id, title), checkpoint:payment_checkpoints(id, description)',
        { count: 'exact' },
      )
      .eq('wallet_id', wallet.id)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (type) q = q.eq('type', type);
    if (project_id) q = q.eq('project_id', project_id);

    const { data, count } = await q;
    return { transactions: (data || []) as Transaction[], total: count ?? 0 };
  }

  async adminDeposit(
    userId: string,
    amount: number,
    description?: string,
  ): Promise<unknown> {
    const wallet = await this.getWallet(userId);
    if (!wallet) throw new NotFoundException('Wallet not found');

    const { error: walletError } = await this.supabase
      .from('wallets')
      .update({ available_balance: wallet.available_balance + amount })
      .eq('id', wallet.id);
    if (walletError) throw new Error(walletError.message);

    const { data, error } = await this.supabase
      .from('transactions')
      .insert({
        wallet_id: wallet.id,
        amount,
        type: 'deposit',
        description: description ?? 'Admin deposit',
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }
}
