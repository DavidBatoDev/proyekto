import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type { QaFixtureManifest } from './qa-fixture.types';

@Injectable()
export class QaFixtureControlService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async reset(key: string, markSuccess = false): Promise<QaFixtureManifest> {
    const result = (await this.supabase.rpc('reset_qa_fixture', {
      p_key: key,
      p_mark_success: markSuccess,
    })) as unknown as {
      data: unknown;
      error: { message: string } | null;
    };
    const { data, error } = result;
    if (error) {
      if (error.message.includes('QA_FIXTURE_NOT_FOUND')) {
        throw new NotFoundException('QA fixture not found.');
      }
      throw new BadRequestException({
        code: 'QA_FIXTURE_RESET_FAILED',
        message: error.message,
      });
    }
    return data as QaFixtureManifest;
  }
}
