/* eslint-disable @typescript-eslint/no-unsafe-assignment -- The shared SupabaseClient is not generated from a Database schema, so embedded rows arrive as any at this boundary. */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import type {
  MarketplaceSurvey,
  SurveyCategory,
  SurveyIntent,
} from '../survey.types';
import type {
  SurveyRepository,
  UpsertSurveyInput,
} from './survey.repository.interface';

const COLUMNS =
  'status, intents, talent_goal, company_size, completed_at, updated_at';

/**
 * `!inner` so a row pointing at a category that has since been deactivated
 * simply stops being returned, rather than arriving with a null parent the
 * mapper would have to guess at. The FK is ON DELETE CASCADE, so a *deleted*
 * category cannot leave a row behind at all.
 */
const CATEGORY_SELECT =
  'position, category:marketplace_categories!inner(slug, name)';

type Row = Record<string, any>;

function firstOf<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

function toCategories(data: unknown): SurveyCategory[] {
  return ((data ?? []) as Row[])
    .map((row) => {
      const category = firstOf(row.category as Row | Row[] | null);
      if (!category) return null;
      return {
        slug: category.slug as string,
        name: category.name as string,
      };
    })
    .filter((row): row is SurveyCategory => row !== null);
}

/**
 * `categories` is filled in by the service, which owns the second read. Keeping
 * it empty here rather than optional means the shape never varies by code path.
 */
function toSurvey(row: Row): MarketplaceSurvey {
  return {
    status: row.status,
    intents: (row.intents ?? []) as string[] as SurveyIntent[],
    categories: [],
    talent_goal: row.talent_goal ?? null,
    company_size: row.company_size ?? null,
    completed_at: row.completed_at ?? null,
    updated_at: row.updated_at,
  };
}

@Injectable()
export class SupabaseSurveyRepository implements SurveyRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async findByUser(userId: string): Promise<MarketplaceSurvey | null> {
    const { data, error } = await this.db
      .from('marketplace_survey_responses')
      .select(COLUMNS)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    return data ? toSurvey(data as Row) : null;
  }

  async upsert(
    userId: string,
    input: UpsertSurveyInput,
  ): Promise<MarketplaceSurvey> {
    const { data, error } = await this.db
      .from('marketplace_survey_responses')
      .upsert({ user_id: userId, ...input }, { onConflict: 'user_id' })
      .select(COLUMNS)
      .single();
    if (error) throw new BadRequestException(error.message);
    return toSurvey(data as Row);
  }

  async markSkipped(userId: string): Promise<MarketplaceSurvey> {
    // Only these two columns, so a partly-answered survey keeps its answers.
    // `completed_at` has to be cleared alongside the status: skipping a row
    // that was somehow already completed would otherwise leave a timestamp
    // behind and fail the status/timestamp CHECK.
    const { data, error } = await this.db
      .from('marketplace_survey_responses')
      .upsert(
        { user_id: userId, status: 'skipped', completed_at: null },
        { onConflict: 'user_id' },
      )
      .select(COLUMNS)
      .single();
    if (error) throw new BadRequestException(error.message);
    return toSurvey(data as Row);
  }

  async findCategories(userId: string): Promise<SurveyCategory[]> {
    const { data, error } = await this.db
      .from('marketplace_survey_categories')
      .select(CATEGORY_SELECT)
      .eq('user_id', userId)
      .order('position', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return toCategories(data);
  }

  async replaceCategories(
    userId: string,
    categoryIds: string[],
  ): Promise<SurveyCategory[]> {
    const { error: deleteError } = await this.db
      .from('marketplace_survey_categories')
      .delete()
      .eq('user_id', userId);
    if (deleteError) throw new BadRequestException(deleteError.message);

    if (categoryIds.length > 0) {
      const { error: insertError } = await this.db
        .from('marketplace_survey_categories')
        .insert(
          categoryIds.map((id, index) => ({
            user_id: userId,
            category_id: id,
            position: index,
          })),
        );
      if (insertError) throw new BadRequestException(insertError.message);
    }

    return this.findCategories(userId);
  }
}
