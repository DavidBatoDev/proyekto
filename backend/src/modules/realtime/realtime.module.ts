import { Module } from '@nestjs/common';
import { RealtimeController } from './realtime.controller';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';
import { ChatModule } from '../chat/chat.module';

/**
 * Hosts the connection-authorize endpoint the realtime Worker calls. Imports
 * RoadmapsModule + ChatModule to reuse their authorization logic. Nothing
 * imports this module, so importing the others creates no cycle. The
 * RealtimePublisher used for fan-out lives in the global RealtimePublisherModule.
 */
@Module({
  imports: [RoadmapsModule, ChatModule],
  controllers: [RealtimeController],
})
export class RealtimeModule {}
