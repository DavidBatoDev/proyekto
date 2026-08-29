import { Module } from '@nestjs/common';
import { BriefGeneratorService } from './brief-generator.service';
import { PostingsController } from './postings.controller';
import { PostingsService } from './postings.service';
import { POSTINGS_REPOSITORY } from './repositories/postings.repository.interface';
import { SupabasePostingsRepository } from './repositories/postings.repository.supabase';

@Module({
  controllers: [PostingsController],
  providers: [
    PostingsService,
    BriefGeneratorService,
    {
      provide: POSTINGS_REPOSITORY,
      useClass: SupabasePostingsRepository,
    },
  ],
  exports: [POSTINGS_REPOSITORY],
})
export class PostingsModule {}
