import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { QA_FIXTURE_SIDE_EFFECT_BLOCKED } from './qa-fixture.types';

@Injectable()
export class QaFixturePolicyService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async isFixtureProject(projectId: string | null): Promise<boolean> {
    if (!projectId) return false;
    const { count, error } = await this.supabase
      .from('qa_fixtures')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId);
    if (error)
      throw new Error(`Could not classify QA fixture: ${error.message}`);
    return Boolean(count);
  }

  async isFixtureTeam(teamId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('qa_fixtures')
      .select('*', { count: 'exact', head: true })
      .or(`primary_team_id.eq.${teamId},secondary_team_id.eq.${teamId}`);
    if (error)
      throw new Error(`Could not classify QA fixture: ${error.message}`);
    return Boolean(count);
  }

  async assertProjectSideEffectAllowed(
    projectId: string | null,
    action: string,
  ): Promise<void> {
    if (!(await this.isFixtureProject(projectId))) return;
    throw this.blocked(action);
  }

  async assertTeamSideEffectAllowed(
    teamId: string,
    action: string,
  ): Promise<void> {
    if (!(await this.isFixtureTeam(teamId))) return;
    throw this.blocked(action);
  }

  private blocked(action: string): ConflictException {
    return new ConflictException({
      code: QA_FIXTURE_SIDE_EFFECT_BLOCKED,
      message: `${action} is disabled for production QA fixtures.`,
    });
  }
}
