import { Module } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { NotificationsModule } from '../../shared/notifications/notifications.module';
import { ProjectsModule } from '../../execution/projects/projects.module';
import { ProfileModule } from '../profile/profile.module';

@Module({
  imports: [NotificationsModule, ProjectsModule, ProfileModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
})
export class MarketplaceModule {}
