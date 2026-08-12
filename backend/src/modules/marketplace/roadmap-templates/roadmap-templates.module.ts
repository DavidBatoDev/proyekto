import { Module } from '@nestjs/common';
import { RoadmapTemplatesController } from './roadmap-templates.controller';
import { RoadmapTemplatesService } from './roadmap-templates.service';

@Module({
  controllers: [RoadmapTemplatesController],
  providers: [RoadmapTemplatesService],
  exports: [RoadmapTemplatesService],
})
export class RoadmapTemplatesModule {}
