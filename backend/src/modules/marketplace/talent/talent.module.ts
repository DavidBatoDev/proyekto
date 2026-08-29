import { Module } from '@nestjs/common';
import { TalentController } from './talent.controller';
import { TalentService } from './talent.service';

@Module({
  controllers: [TalentController],
  providers: [TalentService],
})
export class TalentModule {}
