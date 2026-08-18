import { Module } from '@nestjs/common';
import { ConsultantsController } from './consultants.controller';
import { ConsultantsService } from './consultants.service';
import { TaxonomyModule } from '../taxonomy/taxonomy.module';

@Module({
  imports: [TaxonomyModule],
  controllers: [ConsultantsController],
  providers: [ConsultantsService],
})
export class ConsultantsModule {}
