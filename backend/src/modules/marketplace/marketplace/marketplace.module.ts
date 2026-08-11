import { Module } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { ProjectsModule } from '../../execution/projects/projects.module';

@Module({
  imports: [NotificationsModule, ProjectsModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
})
export class MarketplaceModule {}
