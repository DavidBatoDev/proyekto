import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ApplicationsRepository } from './applications.repository.interface';
import { ConsultantApplication } from '../../../common/entities';
import { CreateApplicationDto } from '../dto/application.dto';

@Injectable()
export class SupabaseApplicationsRepository implements ApplicationsRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async findByUser(userId: string): Promise<ConsultantApplication | null> {
    const { data } = await this.supabase
      .from('consultant_applications')
      .select('*')
      .eq('user_id', userId)
      .single();
    return (data as ConsultantApplication) || null;
  }

  async upsert(
    userId: string,
    dto: CreateApplicationDto,
  ): Promise<ConsultantApplication> {
    const { data, error } = await this.supabase
      .from('consultant_applications')
      .upsert({ user_id: userId, ...dto }, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as ConsultantApplication;
  }

  async submit(userId: string): Promise<ConsultantApplication> {
    const { data, error } = await this.supabase
      .from('consultant_applications')
      .update({ status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('status', ['draft'])
      .select()
      .single();
    if (error || !data)
      throw new Error(
        'Cannot submit: application not found or already submitted',
      );
    return data as ConsultantApplication;
  }
}
