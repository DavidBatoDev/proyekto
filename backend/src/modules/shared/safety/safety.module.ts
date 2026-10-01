import { Module } from '@nestjs/common';
import { ChatModule } from '../../execution/chat/chat.module';
import { RoadmapsModule } from '../../execution/roadmaps/roadmaps.module';
import { BlocksModule } from './blocks.module';
import { ReportsService } from './reports.service';
import { SafetyController } from './safety.controller';

/**
 * Report content and block people (App Store guideline 1.2). Reports reuse the
 * read-side access checks of chat and roadmaps, so this module sits above both;
 * BlocksModule sits below them. MailModule is @Global.
 */
@Module({
  imports: [BlocksModule, ChatModule, RoadmapsModule],
  controllers: [SafetyController],
  providers: [ReportsService],
})
export class SafetyModule {}
