import { Module } from '@nestjs/common';
import { TaxonomyModule } from '../taxonomy/taxonomy.module';
import { SURVEY_REPOSITORY } from './repositories/survey.repository.interface';
import { SupabaseSurveyRepository } from './repositories/survey.repository.supabase';
import { SurveyController } from './survey.controller';
import { SurveyService } from './survey.service';

@Module({
  // For TAXONOMY_REPOSITORY, which resolves the category slugs the modal
  // submits. Importing the module rather than re-querying the taxonomy tables
  // keeps "which categories exist" answered in one place.
  imports: [TaxonomyModule],
  controllers: [SurveyController],
  providers: [
    SurveyService,
    { provide: SURVEY_REPOSITORY, useClass: SupabaseSurveyRepository },
  ],
})
export class SurveyModule {}
