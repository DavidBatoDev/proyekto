import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { EngagementsService } from './engagements.service';

/**
 * The read half of engagements that other modules may import (D25, critic CC4).
 *
 * EngagementsService depends only on SUPABASE_ADMIN, so this module imports nothing but Supabase. TimeModule
 * imports it instead of EngagementsModule, which imports ProjectsModule, TeamsModule and FinanceModule; those
 * import TimeModule, so importing EngagementsModule from TimeModule would be a cycle. EngagementsModule keeps
 * its own EngagementsService provider until P09 switches it to import and re-export this module (two stateless
 * instances in the meantime are harmless).
 */
@Module({
  imports: [SupabaseModule],
  providers: [EngagementsService],
  exports: [EngagementsService],
})
export class EngagementsCoreModule {}
