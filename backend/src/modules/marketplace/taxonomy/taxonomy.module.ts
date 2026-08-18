import { Module } from '@nestjs/common';
import { TaxonomyController } from './taxonomy.controller';
import { TaxonomyService } from './taxonomy.service';
import { TAXONOMY_REPOSITORY } from './repositories/taxonomy.repository.interface';
import { SupabaseTaxonomyRepository } from './repositories/taxonomy.repository.supabase';

@Module({
  controllers: [TaxonomyController],
  providers: [
    TaxonomyService,
    { provide: TAXONOMY_REPOSITORY, useClass: SupabaseTaxonomyRepository },
  ],
  // Exported so the consultants module can resolve category/sub-category slugs
  // to ids without reaching into the taxonomy tables itself. The repository
  // token goes with it for the survey module, which needs the same slug
  // resolution but none of the caching the service wraps around it.
  exports: [TaxonomyService, TAXONOMY_REPOSITORY],
})
export class TaxonomyModule {}
