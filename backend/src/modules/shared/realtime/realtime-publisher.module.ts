import { Global, Module } from '@nestjs/common';
import { RealtimePublisher } from './realtime-publisher.service';

/**
 * Global so any module (roadmaps, chat, …) can inject RealtimePublisher to fan
 * out events without importing a module and risking a dependency cycle — the
 * authorize controller (RealtimeModule) imports RoadmapsModule + ChatModule,
 * which in turn publish via this provider.
 */
@Global()
@Module({
  providers: [RealtimePublisher],
  exports: [RealtimePublisher],
})
export class RealtimePublisherModule {}
