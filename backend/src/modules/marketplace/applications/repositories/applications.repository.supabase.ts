import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import {
  ApplicationDraftInput,
  ApplicationsRepository,
} from './applications.repository.interface';
import { ConsultantApplication } from '../../../../common/entities';

const APPLICATION_SELECT =
  '*, placements:consultant_application_placements(subcategory_id, years_experience, is_primary, position)';

@Injectable()
export class SupabaseApplicationsRepository implements ApplicationsRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async findByUser(userId: string): Promise<ConsultantApplication | null> {
    const { data } = (await this.supabase
      .from('consultant_applications')
      .select(APPLICATION_SELECT)
      .eq('user_id', userId)
      .maybeSingle()) as { data: ConsultantApplication | null };
    return (data as ConsultantApplication) || null;
  }

  async upsert(
    userId: string,
    input: ApplicationDraftInput,
  ): Promise<ConsultantApplication> {
    const { placements, ...fields } = input;

    const { data, error } = await this.supabase
      .from('consultant_applications')
      .upsert({ user_id: userId, ...fields }, { onConflict: 'user_id' })
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(error?.message || 'Failed to save application');
    }
    const applicationId = data.id as string;

    // Replace-set: the wizard always sends the full pick list, so a delete
    // and re-insert keeps ordering and primary flags exact without diffing.
    if (placements) {
      const { error: deleteError } = await this.supabase
        .from('consultant_application_placements')
        .delete()
        .eq('application_id', applicationId);
      if (deleteError) throw new Error(deleteError.message);

      if (placements.length > 0) {
        const { error: insertError } = await this.supabase
          .from('consultant_application_placements')
          .insert(
            placements.map((placement) => ({
              application_id: applicationId,
              ...placement,
            })),
          );
        if (insertError) throw new Error(insertError.message);
      }
    }

    const fresh = await this.findByUser(userId);
    if (!fresh) throw new Error('Failed to reload application after save');
    return fresh;
  }

  async submit(userId: string): Promise<ConsultantApplication> {
    const { data, error } = (await this.supabase
      .from('consultant_applications')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        // A resubmission supersedes the previous verdict; stale review
        // fields would otherwise show the old rejection alongside the new
        // pending status.
        rejection_reason: null,
        reviewed_by: null,
        reviewed_at: null,
      })
      .eq('user_id', userId)
      .in('status', ['draft', 'rejected'])
      .select(APPLICATION_SELECT)
      .single()) as {
      data: ConsultantApplication | null;
      error: { message: string } | null;
    };
    if (error || !data) {
      throw new Error(
        'Cannot submit: application not found or already submitted',
      );
    }
    return data;
  }

  async listActiveAdminUserIds(): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('admin_profiles')
      .select('user_id')
      .eq('is_active', true);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.user_id as string);
  }
}
