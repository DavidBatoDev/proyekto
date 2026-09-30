import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../../config/supabase.module';
import { BlocksService } from './blocks.service';
import { SupabaseSafetyRepository } from './repositories/safety.repository.supabase';
import { SAFETY_REPOSITORY } from './safety.tokens';

/**
 * The low-level half of the safety feature: who has blocked whom. Imported by
 * ChatModule, so it must not import chat (SafetyModule, which does, sits above).
 */
@Module({
  imports: [SupabaseModule],
  providers: [
    BlocksService,
    { provide: SAFETY_REPOSITORY, useClass: SupabaseSafetyRepository },
  ],
  exports: [BlocksService, SAFETY_REPOSITORY],
})
export class BlocksModule {}
