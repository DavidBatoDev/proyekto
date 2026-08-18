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
  // to ids without reaching into the taxonomy tables itself.
  exports: [TaxonomyService],
})
export class TaxonomyModule {}
